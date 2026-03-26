"use client"

import { useEffect, useState } from "react"
import { fetchPoolData, PoolData, POOL_ID, AMM_PACKAGE, fetchAgents, AgentData } from "./chain"

const AGENTS = [
  {
    name: "MomentumBot",
    strategy: "Momentum",
    pnl: 6.09,
    trades: 4,
    wins: 2,
    balance_x: 31641,
    balance_y: 175224,
    color: "#6366f1",
  },
  {
    name: "MeanRevBot",
    strategy: "Mean Reversion",
    pnl: 8.97,
    trades: 5,
    wins: 3,
    balance_x: 143825,
    balance_y: 49976,
    color: "#22c55e",
  },
  {
    name: "MMBot",
    strategy: "Market Maker",
    pnl: 8.39,
    trades: 0,
    wins: 1,
    balance_x: 100000,
    balance_y: 100000,
    color: "#eab308",
  },
]

const BUGS = [
  {
    id: 1,
    severity: "Critical",
    title: "Dead Swap Package",
    file: "client.ts:115",
    description: "Hardcoded PACKAGE_ID doesn't exist on testnet. Every swap fails.",
    badgeClass: "badge-red",
  },
  {
    id: 2,
    severity: "High",
    title: "Zero Slippage Protection",
    file: "client.ts:178",
    description: "min_amount_out = 0. Agents are vulnerable to sandwich attacks.",
    badgeClass: "badge-red",
  },
  {
    id: 3,
    severity: "High",
    title: "Untrusted Bytecode Execution",
    file: "client.ts:225",
    description: "deployCoin publishes arbitrary bytecode from an external API.",
    badgeClass: "badge-yellow",
  },
  {
    id: 4,
    severity: "Medium",
    title: "Silent Tool Call Dropping",
    file: "AgentRuntime.ts:41",
    description: "Only first tool_call executed. Rest silently ignored.",
    badgeClass: "badge-yellow",
  },
]

const ROUNDS = [
  { round: 1, price: 1.0589, momentum: 6.09, meanrev: 2.94, mm: 2.95 },
  { round: 2, price: 1.0876, momentum: 3.95, meanrev: 4.44, mm: 4.38 },
  { round: 3, price: 1.1493, momentum: 5.66, meanrev: 7.91, mm: 7.47 },
  { round: 4, price: 1.1778, momentum: 6.25, meanrev: 9.66, mm: 8.89 },
  { round: 5, price: 1.1678, momentum: 6.09, meanrev: 8.97, mm: 8.39 },
]

function formatBigNumber(n: number): string {
  if (n >= 1e18) return (n / 1e18).toFixed(2) + "B"
  if (n >= 1e15) return (n / 1e15).toFixed(2) + "M"
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "K"
  if (n >= 1e9) return (n / 1e9).toFixed(2)
  return n.toLocaleString()
}

export default function Home() {
  const [pool, setPool] = useState<PoolData | null>(null)
  const [poolLive, setPoolLive] = useState(false)
  const [agents, setAgents] = useState<AgentData[]>([])
  const [agentsLive, setAgentsLive] = useState(false)

  useEffect(() => {
    fetchPoolData().then((data) => {
      if (data) {
        setPool(data)
        setPoolLive(true)
      }
    })
    fetchAgents().then((data) => {
      if (data.length > 0) {
        setAgents(data)
        setAgentsLive(true)
      }
    })
  }, [])

  // Use live agents if available, fall back to static
  const displayAgents = agentsLive
    ? agents.map((a) => ({
        name: a.name,
        strategy: a.strategy,
        pnl: a.initial_value > 0 ? (a.pnl / a.initial_value) * 100 : 0,
        trades: a.trades,
        wins: a.wins,
        balance_x: a.balance_x,
        balance_y: a.balance_y,
        color: a.color,
      }))
    : AGENTS
  const sorted = [...displayAgents].sort((a, b) => b.pnl - a.pnl)

  const poolStats = pool
    ? [
        { label: "Reserve X (COLA)", value: formatBigNumber(pool.reserve_x) },
        { label: "Reserve Y (WATER)", value: formatBigNumber(pool.reserve_y) },
        { label: "LP Supply", value: formatBigNumber(pool.lp_supply) },
        { label: "Price (WATER/COLA)", value: pool.price.toFixed(6) },
        { label: "Fee", value: `${(pool.fee_bps / 100).toFixed(1)}%` },
      ]
    : [
        { label: "Reserve X (COLA)", value: "Loading..." },
        { label: "Reserve Y (WATER)", value: "Loading..." },
        { label: "LP Supply", value: "Loading..." },
        { label: "Price", value: "Loading..." },
        { label: "Fee", value: "0.3%" },
      ]

  return (
    <main
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "48px 24px",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 48 }}>
        <h1
          style={{
            fontSize: 36,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            marginBottom: 8,
          }}
        >
          Agent Colosseum
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 16, maxWidth: 640 }}>
          AI agents compete by trading on a constant-product AMM deployed on
          OneChain. We found 4 bugs in the official SDK, fixed them, built the
          missing DEX, and made agents that actually use it.
        </p>
      </div>

      {/* Architecture */}
      <div className="card" style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
          Architecture
        </h2>
        <div className="grid-arch">
          {[
            {
              layer: "Layer 1",
              title: "Fixed Agent SDK",
              desc: "4 bugs found and patched in onechain-agent",
            },
            {
              layer: "Layer 2",
              title: "Constant-Product AMM",
              desc: "First working DEX on OneChain testnet",
            },
            {
              layer: "Layer 3",
              title: "Agent Colosseum",
              desc: "AI agents compete via on-chain trading",
            },
          ].map((item) => (
            <div
              key={item.layer}
              style={{
                padding: 16,
                background: "var(--bg-secondary)",
                borderRadius: 8,
                border: "1px solid var(--border)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--accent)",
                  textTransform: "uppercase" as const,
                  letterSpacing: "0.08em",
                  marginBottom: 6,
                }}
              >
                {item.layer}
              </div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {item.title}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {item.desc}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bug Fixes */}
      <div className="card" style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
          Bugs Found & Fixed
        </h2>
        <div style={{ display: "grid", gap: 12 }}>
          {BUGS.map((bug) => (
            <div
              key={bug.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: 12,
                background: "var(--bg-secondary)",
                borderRadius: 8,
              }}
            >
              <span className={`badge ${bug.badgeClass}`}>
                {bug.severity}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>
                  #{bug.id}: {bug.title}
                </div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  {bug.description}
                </div>
              </div>
              <code
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  whiteSpace: "nowrap" as const,
                }}
              >
                {bug.file}
              </code>
            </div>
          ))}
        </div>
      </div>

      {/* Leaderboard */}
      <div className="card" style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>
            Agent Leaderboard
          </h2>
          {agentsLive && (
            <span className="badge badge-green" style={{ fontSize: 11 }}>
              LIVE
            </span>
          )}
        </div>
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 580 }}>
          <thead>
            <tr
              style={{
                borderBottom: "1px solid var(--border)",
                fontSize: 12,
                color: "var(--text-secondary)",
                textTransform: "uppercase" as const,
                letterSpacing: "0.06em",
              }}
            >
              <th style={{ textAlign: "left", padding: "8px 0", fontWeight: 600 }}>
                Rank
              </th>
              <th style={{ textAlign: "left", padding: "8px 0", fontWeight: 600 }}>
                Agent
              </th>
              <th style={{ textAlign: "left", padding: "8px 0", fontWeight: 600 }}>
                Strategy
              </th>
              <th style={{ textAlign: "right", padding: "8px 0", fontWeight: 600 }}>
                PnL
              </th>
              <th style={{ textAlign: "right", padding: "8px 0", fontWeight: 600 }}>
                Trades
              </th>
              <th style={{ textAlign: "right", padding: "8px 0", fontWeight: 600 }}>
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((agent, i) => {
              const price = pool ? pool.price : 1.0
              const value = agent.balance_x * price + agent.balance_y
              return (
                <tr
                  key={agent.name}
                  style={{
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <td
                    style={{
                      padding: "14px 0",
                      fontWeight: 700,
                      fontSize: 18,
                      color: i === 0 ? "var(--green)" : "var(--text-secondary)",
                    }}
                  >
                    {i + 1}
                  </td>
                  <td style={{ padding: "14px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: agent.color,
                        }}
                      />
                      <span style={{ fontWeight: 600 }}>{agent.name}</span>
                    </div>
                  </td>
                  <td
                    style={{
                      padding: "14px 0",
                      color: "var(--text-secondary)",
                      fontSize: 14,
                    }}
                  >
                    {agent.strategy}
                  </td>
                  <td
                    style={{
                      padding: "14px 0",
                      textAlign: "right",
                      fontWeight: 600,
                      fontFeatureSettings: "'tnum'",
                      color: agent.pnl >= 0 ? "var(--green)" : "var(--red)",
                    }}
                  >
                    {agent.pnl >= 0 ? "+" : ""}
                    {agent.pnl.toFixed(2)}%
                  </td>
                  <td
                    style={{
                      padding: "14px 0",
                      textAlign: "right",
                      fontFeatureSettings: "'tnum'",
                    }}
                  >
                    {agent.trades}
                  </td>
                  <td
                    style={{
                      padding: "14px 0",
                      textAlign: "right",
                      fontFeatureSettings: "'tnum'",
                    }}
                  >
                    {value.toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* Round History */}
      <div className="card" style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>
            Competition Rounds
          </h2>
          <span className="badge badge-accent" style={{ fontSize: 11 }}>
            SIMULATION
          </span>
        </div>
        <div className="grid-rounds">
          {ROUNDS.map((r) => (
            <div
              key={r.round}
              style={{
                padding: 14,
                background: "var(--bg-secondary)",
                borderRadius: 8,
                border: "1px solid var(--border)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--text-secondary)",
                  marginBottom: 8,
                }}
              >
                ROUND {r.round}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, fontFeatureSettings: "'tnum'" }}>
                {r.price.toFixed(4)}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", display: "grid", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Momentum</span>
                  <span style={{ color: "var(--accent)" }}>+{r.momentum.toFixed(1)}%</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>MeanRev</span>
                  <span style={{ color: "var(--green)" }}>+{r.meanrev.toFixed(1)}%</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>MM</span>
                  <span style={{ color: "var(--yellow)" }}>+{r.mm.toFixed(1)}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pool Stats — LIVE from testnet */}
      <div className="card" style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>
            AMM Pool: COLA / WATER
          </h2>
          {poolLive && (
            <span className="badge badge-green" style={{ fontSize: 11 }}>
              LIVE
            </span>
          )}
        </div>
        <div className="grid-stats">
          {poolStats.map((stat) => (
            <div key={stat.label}>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-secondary)",
                  textTransform: "uppercase" as const,
                  letterSpacing: "0.06em",
                  marginBottom: 4,
                }}
              >
                {stat.label}
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, fontFeatureSettings: "'tnum'" }}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>
        {poolLive && (
          <div style={{ marginTop: 16, fontSize: 12, color: "var(--text-secondary)" }}>
            Pool ID:{" "}
            <code style={{ fontSize: 11 }}>{POOL_ID.slice(0, 10)}...{POOL_ID.slice(-8)}</code>
            {" | "}
            Package:{" "}
            <code style={{ fontSize: 11 }}>{AMM_PACKAGE.slice(0, 10)}...{AMM_PACKAGE.slice(-8)}</code>
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          textAlign: "center",
          padding: "24px 0",
          color: "var(--text-secondary)",
          fontSize: 13,
        }}
      >
        Agent Colosseum &middot; OneHack 3.0 &middot; Built on OneChain (Sui
        fork)
      </div>
    </main>
  )
}
