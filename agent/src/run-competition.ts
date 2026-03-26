/**
 * Agent Colosseum Competition Orchestrator
 *
 * Live mode: agents trade on-chain via Claude tool-calling.
 *   After each turn, orchestrator reads chain state and records verified balances.
 * Demo mode: AMM-math simulation with constant-product pool model.
 *   No random price walks — price emerges from trades against the simulated pool.
 */

import dotenv from "dotenv"
dotenv.config({ override: true })
import { createAgent } from "./runner.js"
import { OneChainClient } from "./OneChainClient.js"
import { MOMENTUM_PROMPT } from "./strategies/momentum.js"
import { MEAN_REVERSION_PROMPT } from "./strategies/meanReversion.js"
import { MARKET_MAKER_PROMPT } from "./strategies/marketMaker.js"
import { Ed25519Keypair } from "@onelabs/sui/keypairs/ed25519"
import { decodeSuiPrivateKey } from "@onelabs/sui/cryptography"
import { fromB64 } from "@onelabs/sui/utils"
import { Transaction } from "@onelabs/sui/transactions"
import { readFileSync } from "fs"

// --- Config ---

const deployed = JSON.parse(
  readFileSync(new URL("../../scripts/deployed.json", import.meta.url), "utf-8"),
)

const AMM_PACKAGE_ID = process.env.AMM_PACKAGE_ID || deployed.contracts.amm.packageId
const COLOSSEUM_PACKAGE_ID =
  process.env.COLOSSEUM_PACKAGE_ID || deployed.contracts.colosseum.packageId
const POOL_ID = process.env.POOL_ID || deployed.pools.cola_water.poolId
const ARENA_ID = process.env.ARENA_ID || deployed.arena.arenaId
const AGENT_PROFILES: Record<string, string> = deployed.arena.agents
const NUM_ROUNDS = parseInt(process.env.ROUNDS || "5")
const TOKEN_SCALE = 1_000_000_000
const FEE_BPS = 30

// --- Types ---

interface AgentConfig {
  name: string
  strategy: string
  prompt: string
  profileId?: string
}

interface AgentState {
  name: string
  strategy: string
  balance_x: number
  balance_y: number
  initial_value: number
  trades: number
  pnl: number
  lastPrice: number
  anchorPrice: number
}

// --- Keypair helpers ---

function loadKeypair(envKey: string): Ed25519Keypair | null {
  const pk = process.env[envKey]
  if (!pk) return null
  try {
    if (pk.startsWith("suiprivkey")) {
      const { secretKey } = decodeSuiPrivateKey(pk)
      return Ed25519Keypair.fromSecretKey(secretKey)
    }
    return Ed25519Keypair.fromSecretKey(fromB64(pk))
  } catch {
    return null
  }
}

function loadAgentKeypairs(): (Ed25519Keypair | null)[] {
  // Per-agent keys take priority, fall back to shared PRIVATE_KEY / MNEMONIC
  const fallback =
    loadKeypair("PRIVATE_KEY") ||
    (process.env.MNEMONIC ? Ed25519Keypair.deriveKeypair(process.env.MNEMONIC) : null)

  return [
    loadKeypair("AGENT_0_KEY") || fallback,
    loadKeypair("AGENT_1_KEY") || fallback,
    loadKeypair("AGENT_2_KEY") || fallback,
  ]
}

// --- AMM simulation (demo mode) ---

interface SimPool {
  reserve_x: number
  reserve_y: number
}

/** Constant-product swap with 0.3% fee. Mutates pool reserves. Returns output amount. */
function simSwap(pool: SimPool, amountIn: number, xToY: boolean): number {
  const reserveIn = xToY ? pool.reserve_x : pool.reserve_y
  const reserveOut = xToY ? pool.reserve_y : pool.reserve_x
  const amountInNet = (amountIn * (10000 - FEE_BPS)) / 10000
  const amountOut = (reserveOut * amountInNet) / (reserveIn + amountInNet)

  if (xToY) {
    pool.reserve_x += amountIn
    pool.reserve_y -= amountOut
  } else {
    pool.reserve_y += amountIn
    pool.reserve_x -= amountOut
  }
  return amountOut
}

function poolPrice(pool: SimPool): number {
  return pool.reserve_y / pool.reserve_x
}

// --- Main ---

const AGENT_CONFIGS: AgentConfig[] = [
  {
    name: "MomentumBot",
    strategy: "Momentum",
    prompt: MOMENTUM_PROMPT,
    profileId: AGENT_PROFILES["MomentumBot"],
  },
  {
    name: "MeanRevBot",
    strategy: "Mean Reversion",
    prompt: MEAN_REVERSION_PROMPT,
    profileId: AGENT_PROFILES["MeanRevBot"],
  },
  {
    name: "MMBot",
    strategy: "Market Maker",
    prompt: MARKET_MAKER_PROMPT,
    profileId: AGENT_PROFILES["MMBot"],
  },
]

async function main() {
  console.log("=== Agent Colosseum Competition ===\n")
  console.log(`AMM: ${AMM_PACKAGE_ID.slice(0, 10)}...`)
  console.log(`Pool: ${POOL_ID.slice(0, 10)}...`)
  console.log(`Rounds: ${NUM_ROUNDS}\n`)

  const keypairs = loadAgentKeypairs()
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY
  const hasWallet = keypairs.some((k) => k !== null)
  const isLive = hasApiKey && hasWallet

  if (isLive) {
    // Check if all agents share a wallet
    const addresses = keypairs.filter((k) => k !== null).map((k) => k!.toSuiAddress())
    const unique = new Set(addresses)
    if (unique.size === 1) {
      console.log(`Warning: all agents share wallet ${addresses[0]}`)
      console.log(`  Set AGENT_0_KEY, AGENT_1_KEY, AGENT_2_KEY for isolation.\n`)
    } else {
      keypairs.forEach((k, i) => {
        if (k) console.log(`${AGENT_CONFIGS[i].name}: ${k.toSuiAddress()}`)
      })
      console.log()
    }
    console.log("Mode: LIVE (on-chain)\n")
    await runLive(keypairs)
  } else {
    if (!hasApiKey) console.log("No ANTHROPIC_API_KEY — running demo.")
    if (!hasWallet) console.log("No wallet keys — running demo.")
    console.log("Mode: DEMO (simulated AMM)\n")
    runDemo()
  }

  console.log("\n=== Competition Complete ===")
}

// ============================================================
// LIVE MODE — real on-chain execution
// ============================================================

async function runLive(keypairs: (Ed25519Keypair | null)[]) {
  const client = new OneChainClient({ ammPackageId: AMM_PACKAGE_ID })
  const suiClient = client.getSuiClient()
  const typeX = `${AMM_PACKAGE_ID}::cola::COLA`
  const typeY = `${AMM_PACKAGE_ID}::water::WATER`

  // Create agent runtimes
  const agents = AGENT_CONFIGS.map((c) =>
    createAgent({
      name: c.name,
      systemPrompt: c.prompt,
      ammPackageId: AMM_PACKAGE_ID,
      colosseumPackageId: COLOSSEUM_PACKAGE_ID,
      poolId: POOL_ID,
      arenaId: ARENA_ID,
      agentProfileId: c.profileId,
    }),
  )

  // Read initial pool price (used as anchor for mean reversion strategy)
  const initPool = await client.getPoolReserves(POOL_ID)
  const anchorPrice = initPool.reserve_x > 0 ? initPool.reserve_y / initPool.reserve_x : 1.0
  let lastPrice = anchorPrice

  // Read initial balances for each agent (for PnL baseline)
  const initialValues: number[] = []
  for (let i = 0; i < keypairs.length; i++) {
    const kp = keypairs[i]
    if (!kp) {
      initialValues.push(0)
      continue
    }
    const addr = kp.toSuiAddress()
    const [bx, by] = await Promise.all([
      suiClient.getBalance({ owner: addr, coinType: typeX }),
      suiClient.getBalance({ owner: addr, coinType: typeY }),
    ])
    const x = Number(bx.totalBalance)
    const y = Number(by.totalBalance)
    initialValues.push(x * lastPrice + y)
  }

  // Competition rounds
  for (let round = 0; round < NUM_ROUNDS; round++) {
    console.log(`\n--- Round ${round + 1} ---`)

    // Read current pool state
    const pool = await client.getPoolReserves(POOL_ID)
    const currentPrice = pool.reserve_x > 0 ? pool.reserve_y / pool.reserve_x : 1.0
    const priceDelta = lastPrice > 0 ? ((currentPrice - lastPrice) / lastPrice) * 100 : 0
    console.log(
      `Pool: ${currentPrice.toFixed(6)} Y/X (${priceDelta >= 0 ? "+" : ""}${priceDelta.toFixed(2)}%)\n`,
    )

    // Each agent takes a turn
    for (let i = 0; i < agents.length; i++) {
      const kp = keypairs[i]
      if (!kp) {
        console.log(`  ${AGENT_CONFIGS[i].name}: SKIP (no wallet)`)
        continue
      }

      // Lean prompt — agent must use tools for real data
      const prompt = `Round ${round + 1}/${NUM_ROUNDS}.
Use getPoolReserves to check the current market price.
Use getBalance to check your token holdings.
Last known price: ~${lastPrice.toFixed(6)} Y per X.
Anchor price (round 0): ~${anchorPrice.toFixed(6)} Y per X.
All token amounts are in base units (9 decimals: 1 token = 1000000000).
Decide what to trade this round.`

      try {
        const result = await agents[i].run(prompt, {
          userAddress: kp.toSuiAddress(),
          wallet: kp,
          ammPackageId: AMM_PACKAGE_ID,
          colosseumPackageId: COLOSSEUM_PACKAGE_ID,
          poolId: POOL_ID,
          arenaId: ARENA_ID,
          agentProfileId: AGENT_CONFIGS[i].profileId,
        })

        // Print Claude's reasoning
        const text = result.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join(" ")
        console.log(`  ${AGENT_CONFIGS[i].name}: ${text.slice(0, 160) || "(tool calls only)"}`)

        // Read verified on-chain balances after agent's turn
        const addr = kp.toSuiAddress()
        const [bx, by] = await Promise.all([
          suiClient.getBalance({ owner: addr, coinType: typeX }),
          suiClient.getBalance({ owner: addr, coinType: typeY }),
        ])
        const onchainX = Number(bx.totalBalance)
        const onchainY = Number(by.totalBalance)

        // Record trade on-chain with verified data
        if (AGENT_CONFIGS[i].profileId) {
          await recordTradeOnChain(
            suiClient,
            kp,
            AGENT_CONFIGS[i].profileId!,
            onchainX,
            onchainY,
            client,
          )
        }
      } catch (err: any) {
        console.log(`  ${AGENT_CONFIGS[i].name}: ERROR — ${err.message?.slice(0, 100)}`)
      }
    }

    // Update price for next round
    const endPool = await client.getPoolReserves(POOL_ID)
    lastPrice = endPool.reserve_x > 0 ? endPool.reserve_y / endPool.reserve_x : lastPrice

    // Print leaderboard from chain
    console.log("\n  Leaderboard:")
    const standings = await Promise.all(
      AGENT_CONFIGS.map(async (c, i) => {
        const kp = keypairs[i]
        if (!kp) return { name: c.name, value: 0, pnl: 0, trades: "?" }
        const addr = kp.toSuiAddress()
        const [bx, by] = await Promise.all([
          suiClient.getBalance({ owner: addr, coinType: typeX }),
          suiClient.getBalance({ owner: addr, coinType: typeY }),
        ])
        const x = Number(bx.totalBalance)
        const y = Number(by.totalBalance)
        const value = x * lastPrice + y
        const pnl = initialValues[i] > 0 ? ((value - initialValues[i]) / initialValues[i]) * 100 : 0
        return { name: c.name, value, pnl, trades: "" }
      }),
    )
    standings.sort((a, b) => b.value - a.value)
    standings.forEach((s, idx) => {
      const humanVal = (s.value / TOKEN_SCALE).toFixed(0)
      console.log(
        `  ${idx + 1}. ${s.name.padEnd(14)} | PnL: ${s.pnl >= 0 ? "+" : ""}${s.pnl.toFixed(2)}% | Value: ${humanVal}`,
      )
    })
  }
}

async function recordTradeOnChain(
  suiClient: any,
  signer: Ed25519Keypair,
  profileId: string,
  balanceX: number,
  balanceY: number,
  client: OneChainClient,
) {
  try {
    const pool = await client.getPoolReserves(POOL_ID)
    // Price scaled by 1e9: (reserve_y / reserve_x) * 1e9
    // Since both reserves are in the same raw units, the ratio * 1e9 gives the scaled price.
    const priceScaled =
      pool.reserve_x > 0
        ? Math.round((pool.reserve_y / pool.reserve_x) * TOKEN_SCALE)
        : TOKEN_SCALE

    const tx = new Transaction()
    tx.moveCall({
      target: `${COLOSSEUM_PACKAGE_ID}::arena::record_trade`,
      arguments: [
        tx.object(profileId),
        tx.pure.u64(balanceX),
        tx.pure.u64(balanceY),
        tx.pure.u64(priceScaled),
      ],
    })
    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer,
      options: { showEffects: true },
    })
    console.log(`  [Recorded] tx: ${result.digest.slice(0, 10)}...`)
  } catch (err: any) {
    console.log(`  [RecordTrade failed] ${err.message?.slice(0, 80)}`)
  }
}

// ============================================================
// DEMO MODE — simulated constant-product AMM
// ============================================================

function runDemo() {
  // Simulated pool — proportional to on-chain (but in human-readable units)
  const pool: SimPool = { reserve_x: 1_000_000, reserve_y: 1_000_000 }

  const states: AgentState[] = AGENT_CONFIGS.map((c) => {
    const initialPrice = poolPrice(pool)
    const initVal = 100_000 * initialPrice + 100_000
    return {
      name: c.name,
      strategy: c.strategy,
      balance_x: 100_000,
      balance_y: 100_000,
      initial_value: initVal,
      trades: 0,
      pnl: 0,
      lastPrice: initialPrice,
      anchorPrice: initialPrice,
    }
  })

  for (let round = 0; round < NUM_ROUNDS; round++) {
    console.log(`\n--- Round ${round + 1} ---`)

    // External noise trader: creates price movement from outside the competition.
    // Deliberately large swaps on a thin pool create 3-10% moves per round.
    // On a real thin DEX, a single whale can do this easily.
    const numNoises = 1 + Math.floor(Math.random() * 3) // 1-3 noise trades
    for (let n = 0; n < numNoises; n++) {
      // Bias slightly toward buying (positive drift), but allow sell rounds too
      const direction = Math.random() < 0.55
      // Trade 3-8% of total reserves
      const fraction = 0.03 + Math.random() * 0.05
      const noiseAmount = pool.reserve_x * fraction
      simSwap(pool, noiseAmount, direction)
    }

    const currentPrice = poolPrice(pool)
    const priceDelta =
      states[0].lastPrice > 0
        ? ((currentPrice - states[0].lastPrice) / states[0].lastPrice) * 100
        : 0
    console.log(
      `Pool: ${currentPrice.toFixed(6)} Y/X (${priceDelta >= 0 ? "+" : ""}${priceDelta.toFixed(2)}%)`,
    )
    console.log(
      `Reserves: ${pool.reserve_x.toFixed(0)} X / ${pool.reserve_y.toFixed(0)} Y\n`,
    )

    // Each agent decides and trades against the simulated pool
    for (let i = 0; i < states.length; i++) {
      const state = states[i]
      const decision = simulateDecision(state, pool, i)

      if (decision.traded) {
        state.balance_x += decision.dx
        state.balance_y += decision.dy
        state.trades += 1
      }

      console.log(
        `  ${state.name}: ${decision.action} | X: ${state.balance_x.toFixed(0)} | Y: ${state.balance_y.toFixed(0)}`,
      )
      state.lastPrice = poolPrice(pool)
    }

    // PnL from current portfolio value vs initial
    const currentPoolPrice = poolPrice(pool)
    for (const state of states) {
      const currentValue = state.balance_x * currentPoolPrice + state.balance_y
      state.pnl = ((currentValue - state.initial_value) / state.initial_value) * 100
    }

    // Leaderboard
    const sorted = [...states].sort((a, b) => b.pnl - a.pnl)
    console.log("\n  Leaderboard:")
    sorted.forEach((s, idx) => {
      const totalValue = s.balance_x * currentPoolPrice + s.balance_y
      console.log(
        `  ${idx + 1}. ${s.name.padEnd(14)} | PnL: ${s.pnl >= 0 ? "+" : ""}${s.pnl.toFixed(2)}% | Value: ${totalValue.toFixed(0)} | Trades: ${s.trades}`,
      )
    })
  }

  // Export results
  const currentPoolPrice = poolPrice(pool)
  const results = states.map((s) => ({
    name: s.name,
    strategy: s.strategy,
    final_balance_x: s.balance_x,
    final_balance_y: s.balance_y,
    trades: s.trades,
    pnl_percent: s.pnl,
    final_value: s.balance_x * currentPoolPrice + s.balance_y,
  }))

  console.log("\nFinal pool: " + pool.reserve_x.toFixed(0) + " X / " + pool.reserve_y.toFixed(0) + " Y")
  console.log("Final price: " + currentPoolPrice.toFixed(6) + " Y/X")
  console.log("\nResults JSON:")
  console.log(JSON.stringify(results, null, 2))
}

/**
 * Deterministic trading strategies for demo mode.
 * Each agent trades against the simulated AMM pool (constant-product math).
 */
function simulateDecision(
  state: AgentState,
  pool: SimPool,
  agentIndex: number,
): { dx: number; dy: number; traded: boolean; action: string } {
  const currentPrice = poolPrice(pool)
  const priceChange = (currentPrice - state.lastPrice) / state.lastPrice
  const deviation = (currentPrice - state.anchorPrice) / state.anchorPrice

  switch (agentIndex) {
    case 0: {
      // Momentum: buy rising, sell falling. 1% threshold — thin pools move fast.
      if (Math.abs(priceChange) < 0.01) {
        return { dx: 0, dy: 0, traded: false, action: "HOLD (low momentum)" }
      }
      const tradeSize = Math.min(state.balance_x, state.balance_y) * 0.25
      if (tradeSize < 1) return { dx: 0, dy: 0, traded: false, action: "HOLD (insufficient balance)" }

      if (priceChange > 0) {
        // Price rising — buy Y by selling X
        const amountIn = Math.min(tradeSize, state.balance_x * 0.3)
        const amountOut = simSwap(pool, amountIn, true)
        return {
          dx: -amountIn,
          dy: amountOut,
          traded: true,
          action: `BUY ${amountIn.toFixed(0)} X → ${amountOut.toFixed(0)} Y`,
        }
      } else {
        // Price falling — sell Y for X
        const amountIn = Math.min(tradeSize, state.balance_y * 0.3)
        const amountOut = simSwap(pool, amountIn, false)
        return {
          dx: amountOut,
          dy: -amountIn,
          traded: true,
          action: `SELL ${amountIn.toFixed(0)} Y → ${amountOut.toFixed(0)} X`,
        }
      }
    }

    case 1: {
      // Mean reversion: buy when below anchor, sell when above. 2% dead zone.
      if (Math.abs(deviation) < 0.02) {
        return { dx: 0, dy: 0, traded: false, action: "HOLD (within 2% of anchor)" }
      }
      const intensity = Math.min(0.4, Math.abs(deviation) * 2)
      const tradeSize = Math.min(state.balance_x, state.balance_y) * intensity
      if (tradeSize < 1) return { dx: 0, dy: 0, traded: false, action: "HOLD (insufficient)" }

      if (deviation < -0.02) {
        // Below anchor — buy Y (expect reversion up)
        const amountIn = Math.min(tradeSize, state.balance_x * 0.4)
        const amountOut = simSwap(pool, amountIn, true)
        return {
          dx: -amountIn,
          dy: amountOut,
          traded: true,
          action: `BUY ${amountIn.toFixed(0)} X → ${amountOut.toFixed(0)} Y (${(deviation * 100).toFixed(1)}% off anchor)`,
        }
      } else if (deviation > 0.02) {
        // Above anchor — sell Y (expect reversion down)
        const amountIn = Math.min(tradeSize, state.balance_y * 0.4)
        const amountOut = simSwap(pool, amountIn, false)
        return {
          dx: amountOut,
          dy: -amountIn,
          traded: true,
          action: `SELL ${amountIn.toFixed(0)} Y → ${amountOut.toFixed(0)} X (${(deviation * 100).toFixed(1)}% off anchor)`,
        }
      } else {
        return { dx: 0, dy: 0, traded: false, action: "HOLD (near anchor)" }
      }
    }

    case 2: {
      // Market maker: rebalance toward 50/50 value split
      const totalValue = state.balance_x * currentPrice + state.balance_y
      if (totalValue < 1) return { dx: 0, dy: 0, traded: false, action: "HOLD (no balance)" }

      const xRatio = (state.balance_x * currentPrice) / totalValue
      if (xRatio > 0.45 && xRatio < 0.55) {
        return { dx: 0, dy: 0, traded: false, action: `HOLD (balanced ${(xRatio * 100).toFixed(0)}%)` }
      }

      if (xRatio >= 0.55) {
        // Too much X — sell X for Y
        const excess = state.balance_x * currentPrice - totalValue * 0.5
        const sellX = excess / currentPrice
        const amountIn = Math.min(sellX, state.balance_x * 0.3)
        const amountOut = simSwap(pool, amountIn, true)
        return {
          dx: -amountIn,
          dy: amountOut,
          traded: true,
          action: `REBALANCE: sell ${amountIn.toFixed(0)} X → ${amountOut.toFixed(0)} Y`,
        }
      } else if (xRatio <= 0.45) {
        // Too much Y — sell Y for X
        const excess = state.balance_y - totalValue * 0.5
        const amountIn = Math.min(excess, state.balance_y * 0.3)
        const amountOut = simSwap(pool, amountIn, false)
        return {
          dx: amountOut,
          dy: -amountIn,
          traded: true,
          action: `REBALANCE: sell ${amountIn.toFixed(0)} Y → ${amountOut.toFixed(0)} X`,
        }
      } else {
        return { dx: 0, dy: 0, traded: false, action: `HOLD (balanced ${(xRatio * 100).toFixed(0)}%)` }
      }
    }

    default:
      return { dx: 0, dy: 0, traded: false, action: "HOLD" }
  }
}

main().catch(console.error)
