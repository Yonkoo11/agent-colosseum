/**
 * Agent Colosseum Competition Orchestrator
 *
 * Runs N rounds of AI agent trading competition.
 * Each agent gets a system prompt (strategy) and access to AMM skills.
 * Results are printed as a leaderboard after each round.
 */

import "dotenv/config"
import { createAgent, AgentConfig } from "./runner.js"
import { SkillContext } from "./types.js"
import { MOMENTUM_PROMPT } from "./strategies/momentum.js"
import { MEAN_REVERSION_PROMPT } from "./strategies/meanReversion.js"
import { MARKET_MAKER_PROMPT } from "./strategies/marketMaker.js"
import { Ed25519Keypair } from "@onelabs/sui/keypairs/ed25519"

// Configuration from environment
const AMM_PACKAGE_ID = process.env.AMM_PACKAGE_ID || "0x0"
const COLOSSEUM_PACKAGE_ID = process.env.COLOSSEUM_PACKAGE_ID || "0x0"
const POOL_ID = process.env.POOL_ID || "0x0"
const ROUNDS = parseInt(process.env.ROUNDS || "5")

interface AgentState {
  name: string
  strategy: string
  balance_x: number
  balance_y: number
  trades: number
  pnl: number // percentage
  lastPrice: number
  anchorPrice: number
}

async function main() {
  console.log("=== Agent Colosseum Competition ===\n")
  console.log(`AMM Package: ${AMM_PACKAGE_ID}`)
  console.log(`Pool: ${POOL_ID}`)
  console.log(`Rounds: ${ROUNDS}\n`)

  // Create agents with different strategies
  const agentConfigs: { name: string; strategy: string; prompt: string }[] = [
    { name: "MomentumBot", strategy: "Momentum", prompt: MOMENTUM_PROMPT },
    { name: "MeanRevBot", strategy: "Mean Reversion", prompt: MEAN_REVERSION_PROMPT },
    { name: "MMBot", strategy: "Market Maker", prompt: MARKET_MAKER_PROMPT },
  ]

  const agents = agentConfigs.map((c) =>
    createAgent({
      name: c.name,
      systemPrompt: c.prompt,
      ammPackageId: AMM_PACKAGE_ID,
      colosseumPackageId: COLOSSEUM_PACKAGE_ID,
      poolId: POOL_ID,
    }),
  )

  // Initialize agent states
  const states: AgentState[] = agentConfigs.map((c) => ({
    name: c.name,
    strategy: c.strategy,
    balance_x: 100_000,
    balance_y: 100_000,
    trades: 0,
    pnl: 0,
    lastPrice: 1.0,
    anchorPrice: 1.0,
  }))

  // Simulate competition rounds
  for (let round = 0; round < ROUNDS; round++) {
    console.log(`\n--- Round ${round + 1} ---\n`)

    // Simulate price movement (random walk)
    const priceChange = (Math.random() - 0.45) * 0.15 // slight upward bias
    const currentPrice = states[0].lastPrice * (1 + priceChange)

    console.log(`Market price: ${currentPrice.toFixed(4)} (${priceChange > 0 ? "+" : ""}${(priceChange * 100).toFixed(2)}%)\n`)

    // Each agent makes a decision
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i]
      const state = states[i]

      const prompt = `Round ${round + 1}/${ROUNDS}.
Current pool price (Y per X): ${currentPrice.toFixed(6)}
Last round price: ${state.lastPrice.toFixed(6)}
Anchor price (round 0): ${state.anchorPrice.toFixed(6)}
Your current balances: ${state.balance_x.toFixed(0)} X, ${state.balance_y.toFixed(0)} Y
Your total value (in Y): ${(state.balance_x * currentPrice + state.balance_y).toFixed(0)}

What do you want to do this round? Explain your reasoning briefly.`

      try {
        if (process.env.OPENAI_API_KEY) {
          // Live mode: agent decides via OpenAI tool calling
          const result = await agent.run(prompt, {
            userAddress: "0x0",
            ammPackageId: AMM_PACKAGE_ID,
            colosseumPackageId: COLOSSEUM_PACKAGE_ID,
            poolId: POOL_ID,
          })
          // Parse agent response for trade info
          console.log(`  ${state.name}: ${result?.slice(0, 120) ?? "no response"}`)
          state.trades += 1
        } else {
          // Demo mode: deterministic simulation, no API key needed
          const decision = simulateDecision(state, currentPrice, i)
          state.balance_x += decision.dx
          state.balance_y += decision.dy
          state.trades += decision.traded ? 1 : 0
          console.log(
            `  ${state.name}: ${decision.action} | X: ${state.balance_x.toFixed(0)} | Y: ${state.balance_y.toFixed(0)}`,
          )
        }
      } catch (err: any) {
        console.log(`  ${state.name}: ERROR - ${err.message}`)
      }

      state.lastPrice = currentPrice
    }

    // Calculate PnL for leaderboard
    for (const state of states) {
      const totalValue = state.balance_x * currentPrice + state.balance_y
      const initialValue = 100_000 * state.anchorPrice + 100_000
      state.pnl = ((totalValue - initialValue) / initialValue) * 100
    }

    // Print leaderboard
    const sorted = [...states].sort((a, b) => b.pnl - a.pnl)
    console.log("\n  Leaderboard:")
    sorted.forEach((s, idx) => {
      const totalValue = s.balance_x * currentPrice + s.balance_y
      console.log(
        `  ${idx + 1}. ${s.name.padEnd(14)} | PnL: ${s.pnl >= 0 ? "+" : ""}${s.pnl.toFixed(2)}% | Value: ${totalValue.toFixed(0)} | Trades: ${s.trades}`,
      )
    })
  }

  console.log("\n=== Competition Complete ===")

  // Export results
  const results = states.map((s) => ({
    name: s.name,
    strategy: s.strategy,
    final_balance_x: s.balance_x,
    final_balance_y: s.balance_y,
    trades: s.trades,
    pnl_percent: s.pnl,
  }))

  console.log("\nResults JSON:")
  console.log(JSON.stringify(results, null, 2))
}

/**
 * Simulate agent trading decisions for demo mode.
 * In production, each agent would call the OpenAI API and use AMM skills.
 */
function simulateDecision(
  state: AgentState,
  currentPrice: number,
  agentIndex: number,
): { dx: number; dy: number; traded: boolean; action: string } {
  const priceChange = (currentPrice - state.lastPrice) / state.lastPrice
  const deviation = (currentPrice - state.anchorPrice) / state.anchorPrice

  switch (agentIndex) {
    case 0: {
      // Momentum: buy on rising, sell on falling
      if (Math.abs(priceChange) < 0.02) return { dx: 0, dy: 0, traded: false, action: "HOLD (low momentum)" }
      const tradeSize = Math.min(state.balance_x * 0.25, state.balance_y * 0.25)
      if (priceChange > 0) {
        // Buy Y (price rising)
        const spent = tradeSize
        const received = spent * currentPrice * 0.997 // 0.3% fee
        return { dx: -spent, dy: received, traded: true, action: `BUY ${spent.toFixed(0)} X → ${received.toFixed(0)} Y` }
      } else {
        // Sell Y
        const spent = tradeSize
        const received = (spent / currentPrice) * 0.997
        return { dx: received, dy: -spent, traded: true, action: `SELL ${spent.toFixed(0)} Y → ${received.toFixed(0)} X` }
      }
    }
    case 1: {
      // Mean reversion: buy when below anchor, sell when above
      if (Math.abs(deviation) < 0.05) return { dx: 0, dy: 0, traded: false, action: "HOLD (within 5% of anchor)" }
      const size = Math.min(state.balance_x, state.balance_y) * Math.min(0.4, Math.abs(deviation))
      if (deviation < -0.05) {
        // Price below anchor: buy Y
        const received = size * currentPrice * 0.997
        return { dx: -size, dy: received, traded: true, action: `BUY ${size.toFixed(0)} X → ${received.toFixed(0)} Y (${(deviation * 100).toFixed(1)}% below anchor)` }
      } else {
        // Price above anchor: sell Y
        const received = (size / currentPrice) * 0.997
        return { dx: received, dy: -size, traded: true, action: `SELL ${size.toFixed(0)} Y → ${received.toFixed(0)} X (${(deviation * 100).toFixed(1)}% above anchor)` }
      }
    }
    case 2: {
      // Market maker: rebalance toward 50/50
      const totalValue = state.balance_x * currentPrice + state.balance_y
      const xRatio = (state.balance_x * currentPrice) / totalValue
      if (xRatio > 0.4 && xRatio < 0.6) return { dx: 0, dy: 0, traded: false, action: "HOLD (balanced)" }
      if (xRatio > 0.6) {
        // Too much X, sell some
        const excess = state.balance_x * currentPrice - totalValue * 0.5
        const sellX = excess / currentPrice
        const received = sellX * currentPrice * 0.997
        return { dx: -sellX, dy: received, traded: true, action: `REBALANCE: sell ${sellX.toFixed(0)} X` }
      } else {
        // Too much Y, buy X
        const excess = state.balance_y - totalValue * 0.5
        const received = (excess / currentPrice) * 0.997
        return { dx: received, dy: -excess, traded: true, action: `REBALANCE: sell ${excess.toFixed(0)} Y` }
      }
    }
    default:
      return { dx: 0, dy: 0, traded: false, action: "HOLD" }
  }
}

main().catch(console.error)
