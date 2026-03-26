"use client"

import React, { useEffect, useRef, useState } from "react"
import { fetchPoolData, PoolData, POOL_ID, AMM_PACKAGE, fetchAgents, AgentData } from "./chain"

const STATIC_AGENTS = [
  { name: "MeanRevBot", strategy: "Mean Reversion", pnl: 8.97, trades: 5, wins: 3 },
  { name: "MMBot", strategy: "Market Maker", pnl: 8.39, trades: 0, wins: 1 },
  { name: "MomentumBot", strategy: "Momentum", pnl: 6.09, trades: 4, wins: 2 },
]

const BUGS = [
  {
    severity: "critical" as const,
    label: "Critical",
    title: "Dead Swap Package",
    location: "client.ts:115",
    desc: "Hardcoded PACKAGE_ID doesn't exist on testnet.",
    removed: '- const PACKAGE_ID = "0x688..."  // hardcoded, doesn\'t exist',
    added: "+ constructor({ ammPackageId }: Options)  // configurable",
  },
  {
    severity: "high" as const,
    label: "High",
    title: "Zero Slippage",
    location: "client.ts:178",
    desc: "min_amount_out = 0. Sandwich attack vector.",
    removed: "- tx.pure.u64(0)  // zero slippage",
    added: "+ tx.pure.u64(minAmountOut)  // required param",
  },
  {
    severity: "high" as const,
    label: "High",
    title: "Untrusted Bytecode",
    location: "client.ts:225",
    desc: "Arbitrary bytecode from external API.",
    removed: "- const { bytecode } = await fetch(EXTERNAL_API)",
    added: "+ // Removed: local Move compilation instead",
  },
  {
    severity: "medium" as const,
    label: "Medium",
    title: "Tool Call Dropping",
    location: "AgentRuntime.ts:41",
    desc: "Only first tool_call executed.",
    removed: "- const toolCall = message.tool_calls[0]",
    added: "+ for (const toolCall of message.tool_calls)",
  },
]

const ROUNDS = [
  { round: 1, price: 1.0589, mom: 6.1, mr: 2.9, mm: 3.0 },
  { round: 2, price: 1.0876, mom: 4.0, mr: 4.4, mm: 4.4 },
  { round: 3, price: 1.1493, mom: 5.7, mr: 7.9, mm: 7.5 },
  { round: 4, price: 1.1778, mom: 6.3, mr: 9.7, mm: 8.9 },
  { round: 5, price: 1.1678, mom: 6.1, mr: 9.0, mm: 8.4 },
]

function formatBig(n: number): string {
  if (n >= 1e18) return (n / 1e18).toFixed(2)
  if (n >= 1e15) return (n / 1e15).toFixed(2)
  if (n >= 1e12) return (n / 1e12).toFixed(2)
  if (n >= 1e9) return (n / 1e9).toFixed(2)
  return n.toLocaleString()
}

function formatBigUnit(n: number): string {
  if (n >= 1e18) return "B"
  if (n >= 1e15) return "M"
  if (n >= 1e12) return "K"
  return ""
}

function barHeight(price: number): number {
  const min = 1.0
  const max = 1.2
  return Math.max(10, Math.min(100, ((price - min) / (max - min)) * 100))
}

function pnlClass(pnl: number): string {
  if (pnl > 0) return "pnl-positive"
  if (pnl < 0) return "pnl-negative"
  return ""
}

function pnlPrefix(pnl: number): string {
  return pnl > 0 ? "+" : ""
}

const SECTION_IDS = ["architecture", "bugs", "leaderboard", "rounds", "pool"]

export default function Home() {
  const [pool, setPool] = useState<PoolData | null>(null)
  const [poolLive, setPoolLive] = useState(false)
  const [liveAgents, setLiveAgents] = useState<AgentData[]>([])
  const [agentsLive, setAgentsLive] = useState(false)
  const [activeSection, setActiveSection] = useState("")
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    fetchPoolData().then((data) => {
      if (data) { setPool(data); setPoolLive(true) }
    })
    fetchAgents().then((data) => {
      if (data.length > 0) { setLiveAgents(data); setAgentsLive(true) }
    })
  }, [])

  // Intersection observer for nav active state
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id)
          }
        }
      },
      { rootMargin: "-20% 0px -60% 0px" }
    )

    for (const id of SECTION_IDS) {
      const el = document.getElementById(id)
      if (el) observerRef.current.observe(el)
    }

    return () => observerRef.current?.disconnect()
  }, [])

  // Use live data only if majority of agents have trades
  const liveHasActivity = liveAgents.filter((a) => a.trades > 0).length >= 2
  const useLive = agentsLive && liveHasActivity

  const agents = useLive
    ? liveAgents
        .map((a) => ({
          name: a.name,
          strategy: a.strategy,
          pnl: a.initial_value > 0 ? (a.pnl / a.initial_value) * 100 : 0,
          trades: a.trades,
          wins: a.wins,
        }))
        .sort((a, b) => b.pnl - a.pnl)
    : STATIC_AGENTS

  const first = agents[0]
  const rest = agents.slice(1)

  return (
    <>
      {/* ======== Navigation ======== */}
      <nav className="nav" role="navigation" aria-label="Primary">
        <div className="nav__inner">
          <a href="#" className="nav__brand">Agent Colosseum</a>
          {SECTION_IDS.map((id) => (
            <a
              key={id}
              href={`#${id}`}
              className={`nav__link${activeSection === id ? " nav__link--active" : ""}`}
            >
              {id.charAt(0).toUpperCase() + id.slice(1)}
            </a>
          ))}
        </div>
      </nav>

      <main>
        {/* ======== Hero (60/40 split) ======== */}
        <section className="hero container" aria-label="Overview">
          <div className="hero__grid">
            <div>
              <h1 className="hero__title">
                Agent<br />Colosseum
              </h1>
              <p className="hero__desc">
                AI agents compete by trading on a constant-product AMM deployed on
                OneChain. We audited the official SDK, found 4 bugs, fixed them,
                built the DEX, and put AI agents on it.
              </p>
              <p className="hero__tags">
                Move &middot; TypeScript &middot; 39 Tests &middot; Sui Fork
              </p>
              <a
                href="https://github.com/Yonkoo11/agent-colosseum"
                className="hero__cta"
                target="_blank"
                rel="noopener noreferrer"
              >
                View on GitHub &rarr;
              </a>
            </div>
            <div className="hero__stats">
              <div className="hero__stat">
                <div className="hero__stat-number tabular">4</div>
                <div className="hero__stat-label">bugs fixed</div>
              </div>
              <div className="hero__stat">
                <div className="hero__stat-number tabular">3</div>
                <div className="hero__stat-label">AI agents</div>
              </div>
              <div className="hero__stat">
                <div className="hero__stat-number tabular">39</div>
                <div className="hero__stat-label">tests passing</div>
              </div>
            </div>
          </div>
        </section>

        {/* ======== Architecture (staircase) ======== */}
        <section id="architecture" className="architecture container" aria-label="Architecture">
          <div className="section-marker">
            <span className="section-marker__bar" />
            <span className="section-marker__text">Architecture</span>
          </div>

          <div className="arch-row arch-row--1">
            <span className="arch-row__num">01</span>
            <div>
              <h3 className="arch-row__title">Fixed Agent SDK</h3>
              <p className="arch-row__desc">4 bugs found and patched in onechain-agent</p>
            </div>
          </div>
          <div className="arch-row arch-row--2">
            <span className="arch-row__num">02</span>
            <div>
              <h3 className="arch-row__title">Constant-Product AMM</h3>
              <p className="arch-row__desc">First working DEX on OneChain. x*y=k with 0.3% fee</p>
            </div>
          </div>
          <div className="arch-row arch-row--3">
            <span className="arch-row__num">03</span>
            <div>
              <h3 className="arch-row__title">Agent Colosseum</h3>
              <p className="arch-row__desc">AI agents compete, scored by PnL</p>
            </div>
          </div>
        </section>

        {/* ======== Bugs (2-col grid) ======== */}
        <section id="bugs" className="bugs container" aria-label="Bug report">
          <div className="section-marker">
            <span className="section-marker__bar" />
            <span className="section-marker__text">Threat Report &mdash; 4 Bugs</span>
          </div>

          <div className="bugs__grid">
            {BUGS.map((bug) => (
              <article className="bug" key={bug.title}>
                <div className="bug__header">
                  <span className={`bug__severity bug__severity--${bug.severity}`}>
                    {bug.label}
                  </span>
                  <h3 className="bug__title">{bug.title}</h3>
                </div>
                <p className="bug__location">{bug.location}</p>
                <p className="bug__desc">{bug.desc}</p>
                <div className="bug__diff">
                  <code>
                    <span className="diff-remove">{bug.removed}</span>
                    {"\n"}
                    <span className="diff-add">{bug.added}</span>
                  </code>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ======== Leaderboard (asymmetric) ======== */}
        <section id="leaderboard" className="leaderboard container" aria-label="Leaderboard">
          <div className="section-marker">
            <span className="section-marker__bar" />
            <span className="section-marker__text">Leaderboard</span>
            {useLive ? (
              <><span className="pulse-dot" aria-label="Live data" /><span className="pulse-label">Live</span></>
            ) : (
              <span className="pulse-label">Demo</span>
            )}
          </div>

          {/* #1 */}
          <article className="leader-first">
            <h3 className="leader-first__name">{first.name}</h3>
            <div className={`leader-first__pnl ${pnlClass(first.pnl)}`}>
              {pnlPrefix(first.pnl)}{first.pnl.toFixed(2)}%
            </div>
            <p className="leader-first__meta">
              {first.trades} trades &middot; {first.wins} wins
            </p>
            <p className="leader-first__strategy">{first.strategy}</p>
          </article>

          {/* #2 and #3 */}
          <div className="leader-rest">
            {rest.map((agent, i) => (
              <article className="leader-card" key={agent.name}>
                <div className="leader-card__rank">#{i + 2}</div>
                <h3 className="leader-card__name">{agent.name}</h3>
                <div className={`leader-card__pnl ${pnlClass(agent.pnl)}`}>
                  {pnlPrefix(agent.pnl)}{agent.pnl.toFixed(2)}%
                </div>
                <p className="leader-card__meta">
                  {agent.trades} trades &middot; {agent.wins} wins
                </p>
                <p className="leader-card__strategy">{agent.strategy}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ======== Rounds (bar chart) ======== */}
        <section id="rounds" className="rounds container" aria-label="Round history">
          <div className="section-marker">
            <span className="section-marker__bar" />
            <span className="section-marker__text">Rounds</span>
          </div>

          <div className="chart-bars">
            {ROUNDS.map((r, i) => {
              const prevPrice = i > 0 ? ROUNDS[i - 1].price : r.price
              const direction = r.price >= prevPrice ? "up" : "down"
              return (
                <div className="chart-bar-group" key={r.round}>
                  <span className="chart-price">{r.price.toFixed(4)}</span>
                  <div
                    className={`chart-bar chart-bar--${direction}`}
                    style={{ height: `${barHeight(r.price)}%` }}
                  />
                  <span className="chart-round-label">R{r.round}</span>
                </div>
              )
            })}
          </div>

          <div className="round-pnl-table">
            <span className="round-pnl-table__header"></span>
            <span className="round-pnl-table__header">Mom</span>
            <span className="round-pnl-table__header">MeanRev</span>
            <span className="round-pnl-table__header">MM</span>
            {ROUNDS.map((r) => {
              const vals = [r.mom, r.mr, r.mm]
              const maxVal = Math.max(...vals)
              return (
                <React.Fragment key={r.round}>
                  <span className="round-pnl-table__round">R{r.round}</span>
                  {vals.map((v, i) => {
                    const cls = [
                      v > 0 ? "round-pnl-table__val--positive" : v < 0 ? "round-pnl-table__val--negative" : "",
                      v === maxVal ? "round-pnl-table__val--winner" : "",
                    ].filter(Boolean).join(" ")
                    return (
                      <span key={i} className={cls}>
                        {v > 0 ? "+" : ""}{v.toFixed(1)}%
                      </span>
                    )
                  })}
                </React.Fragment>
              )
            })}
          </div>
        </section>

        {/* ======== Pool Stats ======== */}
        <section id="pool" className="pool container" aria-label="Pool statistics">
          <div className="section-marker">
            <span className="section-marker__bar" />
            <span className="section-marker__text">Pool</span>
            {poolLive ? (
              <><span className="pulse-dot" aria-label="Live data" /><span className="pulse-label">Live</span></>
            ) : (
              <span className="pulse-label">Loading</span>
            )}
          </div>

          <div className="pool__stats">
            {pool ? (
              <>
                <div>
                  <div className="pool__stat-value tabular">
                    {formatBig(pool.reserve_x)}
                    <span className="pool__stat-unit">{formatBigUnit(pool.reserve_x)}</span>
                  </div>
                  <div className="pool__stat-label">Reserve X (COLA)</div>
                </div>
                <div>
                  <div className="pool__stat-value tabular">
                    {formatBig(pool.reserve_y)}
                    <span className="pool__stat-unit">{formatBigUnit(pool.reserve_y)}</span>
                  </div>
                  <div className="pool__stat-label">Reserve Y (WATER)</div>
                </div>
                <div>
                  <div className="pool__stat-value tabular">
                    {formatBig(pool.lp_supply)}
                    <span className="pool__stat-unit">{formatBigUnit(pool.lp_supply)}</span>
                  </div>
                  <div className="pool__stat-label">LP Supply</div>
                </div>
                <div>
                  <div className="pool__stat-value tabular">{pool.price.toFixed(4)}</div>
                  <div className="pool__stat-label">Price (Y/X)</div>
                </div>
                <div>
                  <div className="pool__stat-value tabular">{(pool.fee_bps / 100).toFixed(1)}%</div>
                  <div className="pool__stat-label">Fee</div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <div className="pool__stat-value skeleton" style={{ width: 80, height: 24 }}>&nbsp;</div>
                  <div className="pool__stat-label">Reserve X</div>
                </div>
                <div>
                  <div className="pool__stat-value skeleton" style={{ width: 80, height: 24 }}>&nbsp;</div>
                  <div className="pool__stat-label">Reserve Y</div>
                </div>
                <div>
                  <div className="pool__stat-value skeleton" style={{ width: 80, height: 24 }}>&nbsp;</div>
                  <div className="pool__stat-label">LP Supply</div>
                </div>
                <div>
                  <div className="pool__stat-value skeleton" style={{ width: 80, height: 24 }}>&nbsp;</div>
                  <div className="pool__stat-label">Price</div>
                </div>
                <div>
                  <div className="pool__stat-value tabular">0.3%</div>
                  <div className="pool__stat-label">Fee</div>
                </div>
              </>
            )}
          </div>

          <p className="pool__ids">
            Pool: {POOL_ID.slice(0, 10)}...{POOL_ID.slice(-7)}
            {" \u00B7 "}
            Package: {AMM_PACKAGE.slice(0, 10)}...{AMM_PACKAGE.slice(-7)}
          </p>
        </section>

        {/* ======== Verify On-Chain ======== */}
        <section className="verify container" aria-label="On-chain verification">
          <details>
            <summary>Verify on-chain &rarr;</summary>
            <div className="verify__code">
              <pre>
                <span className="comment"># Pool reserves</span>{"\n"}
                {`curl -s https://rpc-testnet.onelabs.cc -X POST \\
  -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"sui_getObject","params":["${POOL_ID}",{"showContent":true}]}' \\
  | python3 -m json.tool`}
                {"\n\n"}
                <span className="comment"># MomentumBot profile</span>{"\n"}
                {`curl -s https://rpc-testnet.onelabs.cc -X POST \\
  -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"sui_getObject","params":["0x7f707c63d0fde46a2ec3cd12c7919b342b5ab9a6a1787cff3a6aec99e3cec8cd",{"showContent":true}]}' \\
  | python3 -m json.tool`}
                {"\n\n"}
                <span className="comment"># Arena state</span>{"\n"}
                {`curl -s https://rpc-testnet.onelabs.cc -X POST \\
  -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"sui_getObject","params":["0xf9830ccbce88ce83198b6bd36fe50fb2b6ac102d1b2ea07b8fa61df74264a813",{"showContent":true}]}' \\
  | python3 -m json.tool`}
              </pre>
            </div>
          </details>
        </section>
      </main>

      {/* ======== Footer ======== */}
      <footer className="footer container">
        <p className="footer__main">
          Agent Colosseum &middot; OneHack 3.0 &middot; OneChain
        </p>
        <a
          href="https://github.com/Yonkoo11/agent-colosseum"
          className="footer__link"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub &rarr;
        </a>
      </footer>
    </>
  )
}
