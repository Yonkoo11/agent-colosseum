"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import { fetchPoolData, PoolData, POOL_ID, AMM_PACKAGE, fetchAgents, AgentData, TOKEN_SCALE } from "./chain"

/** Hook: Intersection Observer that adds .is-visible to elements with .reveal or .reveal-stagger */
function useScrollReveal() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible")
            observer.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.15 }
    )
    const els = document.querySelectorAll(".reveal, .reveal-stagger")
    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])
}

/** Hook: Animated number counter */
function useCountUp(target: number, duration = 800) {
  const [value, setValue] = useState(0)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const start = performance.now()
    function tick(now: number) {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(eased * target))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [target, duration])

  return value
}

// Placeholder agent names shown while chain data loads
const PLACEHOLDER_AGENTS = [
  { name: "MomentumBot", strategy: "Momentum" },
  { name: "MeanRevBot", strategy: "Mean Reversion" },
  { name: "MMBot", strategy: "Market Maker" },
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

/** Format raw token amount (9 decimals) into human-readable string */
function formatTokens(raw: number): string {
  const tokens = raw / TOKEN_SCALE
  if (tokens >= 1e9) return (tokens / 1e9).toFixed(2)
  if (tokens >= 1e6) return (tokens / 1e6).toFixed(2)
  if (tokens >= 1e3) return (tokens / 1e3).toFixed(1)
  return tokens.toFixed(2)
}

function formatTokensUnit(raw: number): string {
  const tokens = raw / TOKEN_SCALE
  if (tokens >= 1e9) return "B"
  if (tokens >= 1e6) return "M"
  if (tokens >= 1e3) return "K"
  return ""
}

/** Format portfolio value for leaderboard display */
function formatPortfolio(raw: number): string {
  const tokens = raw / TOKEN_SCALE
  if (tokens >= 1e9) return (tokens / 1e9).toFixed(2) + "B"
  if (tokens >= 1e6) return (tokens / 1e6).toFixed(2) + "M"
  if (tokens >= 1e3) return (tokens / 1e3).toFixed(1) + "K"
  return tokens.toFixed(2)
}

function barHeight(price: number, allPrices: number[]): number {
  // Zero-based proportional bars: tallest bar = 95%, others scale linearly from 0
  const maxPrice = Math.max(...allPrices)
  if (maxPrice === 0) return 10
  return Math.max(10, (price / maxPrice) * 95)
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
const SECTION_LABELS: Record<string, string> = {
  architecture: "Architecture",
  bugs: "Bugs",
  leaderboard: "Leaderboard",
  rounds: "Simulation",
  pool: "Pool",
}

export default function Home() {
  const [pool, setPool] = useState<PoolData | null>(null)
  const [poolLive, setPoolLive] = useState(false)
  const [liveAgents, setLiveAgents] = useState<AgentData[]>([])
  const [agentsLive, setAgentsLive] = useState(false)
  const [activeSection, setActiveSection] = useState("")
  const observerRef = useRef<IntersectionObserver | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // Animated counters for hero stats
  const bugCount = useCountUp(4, 600)
  const agentCount = useCountUp(3, 700)
  const testCount = useCountUp(39, 900)

  // Scroll reveal animations
  useScrollReveal()

  useEffect(() => {
    const load = () => {
      fetchPoolData().then((data) => {
        if (data) { setPool(data); setPoolLive(true); setLastUpdated(new Date()) }
      })
      fetchAgents().then((data) => {
        if (data.length > 0) { setLiveAgents(data); setAgentsLive(true) }
      })
    }
    load()
    const interval = setInterval(load, 30_000)
    return () => clearInterval(interval)
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

  // Use chain data whenever available; show placeholders only while loading
  const poolPrice = pool?.price || 1

  const agents = agentsLive
    ? liveAgents
        .map((a) => {
          const portfolioRaw = a.balance_x * poolPrice + a.balance_y
          // Only show PnL% when initial_value is meaningful (> 1 token in raw units).
          // The on-chain initial_value was set at registration and may be a placeholder.
          const hasReliablePnl = a.initial_value > TOKEN_SCALE
          const pnlPct = hasReliablePnl
            ? ((portfolioRaw - a.initial_value) / a.initial_value) * 100
            : 0
          return {
            name: a.name,
            strategy: a.strategy,
            pnl: pnlPct,
            hasPnl: hasReliablePnl,
            portfolioValue: portfolioRaw,
            trades: a.trades,
            wins: a.wins,
          }
        })
        .sort((a, b) => b.portfolioValue - a.portfolioValue)
    : PLACEHOLDER_AGENTS.map((a) => ({ ...a, pnl: 0, hasPnl: false, portfolioValue: 0, trades: 0, wins: 0 }))

  const hasAnyTrades = agents.some((a) => a.trades > 0)

  const allWinsZero = agents.every((a) => a.wins === 0)
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
              {SECTION_LABELS[id] || id}
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
                AI agents compete by trading COLA/WATER tokens on a constant-product
                AMM deployed on OneChain. We audited the official SDK, found 4 bugs,
                fixed them, built the DEX, and put AI agents on it.
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
                <div className="hero__stat-number tabular">{bugCount}</div>
                <div className="hero__stat-label">Bugs Fixed</div>
              </div>
              <div className="hero__stat-divider" />
              <div className="hero__stat">
                <div className="hero__stat-number tabular">{agentCount}</div>
                <div className="hero__stat-label">AI Agents</div>
              </div>
              <div className="hero__stat-divider" />
              <div className="hero__stat">
                <div className="hero__stat-number tabular">{testCount}</div>
                <div className="hero__stat-label">Tests</div>
              </div>
            </div>
          </div>
        </section>

        {/* ======== Architecture (stacked layers) ======== */}
        <section id="architecture" className="architecture container section-glow reveal" aria-label="Architecture">
          <div className="section-marker">
            <span className="section-marker__bar" />
            <span className="section-marker__text">Architecture</span>
          </div>

          <div className="arch-stack reveal-stagger">
            <div className="arch-layer arch-layer--active">
              <span className="arch-layer__num">01</span>
              <div>
                <h3 className="arch-layer__title">Fixed Agent SDK</h3>
                <p className="arch-layer__desc">We read their code, found 4 bugs, patched them. The foundation everything else depends on.</p>
              </div>
              <a href="#bugs" className="arch-layer__tag">See bugs</a>
            </div>

            <div className="arch-connector">
              <span className="arch-connector__line" />
              <span className="arch-connector__label">builds on</span>
            </div>

            <div className="arch-layer">
              <span className="arch-layer__num">02</span>
              <div>
                <h3 className="arch-layer__title">Constant-Product AMM</h3>
                <p className="arch-layer__desc">First working token exchange on OneChain. x*y=k with 0.3% fee, 20 passing tests.</p>
              </div>
              <a href="#pool" className="arch-layer__tag">See pool</a>
            </div>

            <div className="arch-connector">
              <span className="arch-connector__line" />
              <span className="arch-connector__label">enables</span>
            </div>

            <div className="arch-layer">
              <span className="arch-layer__num">03</span>
              <div>
                <h3 className="arch-layer__title">Agent Colosseum</h3>
                <p className="arch-layer__desc">3 AI agents with different strategies compete by trading on the real DEX, ranked by PnL.</p>
              </div>
              <a href="#leaderboard" className="arch-layer__tag">See rankings</a>
            </div>
          </div>
        </section>

        {/* ======== Bugs (2-col grid) ======== */}
        <section id="bugs" className="bugs container section-glow reveal" aria-label="Bug report">
          <div className="section-marker">
            <span className="section-marker__bar" />
            <span className="section-marker__text">Threat Report &mdash; 4 Bugs</span>
          </div>

          <div className="bugs__grid reveal-stagger">
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
        <section id="leaderboard" className="leaderboard container section-glow reveal" aria-label="Leaderboard">
          <div className="section-marker">
            <span className="section-marker__bar" />
            <span className="section-marker__text">Leaderboard</span>
            {agentsLive ? (
              <><span className="pulse-dot" aria-label="Live data" /><span className="pulse-label">Live</span></>
            ) : (
              <span className="pulse-label">Loading</span>
            )}
            {lastUpdated && (
              <span className="section-marker__timestamp">
                {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* #1 */}
          <article className="leader-first">
            <div className="leader-first__header">
              <h3 className="leader-first__name">{first.name}</h3>
              <span className="leader-first__strategy-tag">{first.strategy}</span>
            </div>
            {first.trades > 0 ? (
              <div className="leader-first__value tabular">
                {formatPortfolio(first.portfolioValue)}
                <span className="leader-first__value-label">portfolio</span>
                {first.hasPnl && (
                  <span className={`leader-first__pnl-inline ${pnlClass(first.pnl)}`}>
                    {pnlPrefix(first.pnl)}{first.pnl.toFixed(2)}%
                  </span>
                )}
              </div>
            ) : agentsLive ? (
              <div className="leader-first__pnl text-muted-sm">
                Registered &middot; awaiting first trade
              </div>
            ) : (
              <div className="leader-first__pnl text-muted-sm">
                &mdash;
              </div>
            )}
            <p className="leader-first__meta">
              {first.trades} trades{!allWinsZero && <> &middot; {first.wins} wins</>}
            </p>
          </article>

          {/* #2 and #3 */}
          <div className="leader-rest">
            {rest.map((agent, i) => (
              <article className="leader-card" key={agent.name}>
                <div className="leader-card__rank">#{i + 2}</div>
                <div className="leader-card__header">
                  <h3 className="leader-card__name">{agent.name}</h3>
                  <span className="leader-card__strategy-tag">{agent.strategy}</span>
                </div>
                {agent.trades > 0 ? (
                  <div className="leader-card__value tabular">
                    {formatPortfolio(agent.portfolioValue)}
                    {agent.hasPnl && (
                      <span className={`leader-card__pnl-inline ${pnlClass(agent.pnl)}`}>
                        {pnlPrefix(agent.pnl)}{agent.pnl.toFixed(2)}%
                      </span>
                    )}
                  </div>
                ) : agentsLive ? (
                  <div className="leader-card__pnl text-muted-sm">
                    Awaiting first trade
                  </div>
                ) : (
                  <div className="leader-card__pnl text-muted-sm">
                    &mdash;
                  </div>
                )}
                <p className="leader-card__meta">
                  {agent.trades} trades{!allWinsZero && <> &middot; {agent.wins} wins</>}
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* ======== Rounds (bar chart) ======== */}
        <section id="rounds" className="rounds container reveal" aria-label="Simulation results">
          <div className="section-marker">
            <span className="section-marker__bar" />
            <span className="section-marker__text">Simulation</span>
            <span className="pulse-label">Pre-competition dry run</span>
          </div>

          <div className="chart-bars">
            {(() => { const allPrices = ROUNDS.map((x) => x.price); return ROUNDS.map((r, i) => {
              const prevPrice = i > 0 ? ROUNDS[i - 1].price : r.price
              const direction = r.price >= prevPrice ? "up" : "down"
              return (
                <div className="chart-bar-group" key={r.round}>
                  <span className="chart-price">{r.price.toFixed(4)}</span>
                  <div
                    className={`chart-bar chart-bar--${direction}`}
                    style={{ height: `${barHeight(r.price, allPrices)}%` }}
                  />
                  <span className="chart-round-label">R{r.round}</span>
                </div>
              )
            }) })()}
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
        <section id="pool" className="pool container reveal" aria-label="Pool statistics">
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
                    {formatTokens(pool.reserve_x)}
                    <span className="pool__stat-unit">{formatTokensUnit(pool.reserve_x)} COLA</span>
                  </div>
                  <div className="pool__stat-label">Reserve X</div>
                </div>
                <div>
                  <div className="pool__stat-value tabular">
                    {formatTokens(pool.reserve_y)}
                    <span className="pool__stat-unit">{formatTokensUnit(pool.reserve_y)} WATER</span>
                  </div>
                  <div className="pool__stat-label">Reserve Y</div>
                </div>
                <div>
                  <div className="pool__stat-value tabular">
                    {formatTokens(pool.lp_supply)}
                    <span className="pool__stat-unit">{formatTokensUnit(pool.lp_supply)} LP</span>
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
                  <div className="pool__stat-value skeleton skeleton--stat">&nbsp;</div>
                  <div className="pool__stat-label">Reserve X</div>
                </div>
                <div>
                  <div className="pool__stat-value skeleton skeleton--stat">&nbsp;</div>
                  <div className="pool__stat-label">Reserve Y</div>
                </div>
                <div>
                  <div className="pool__stat-value skeleton skeleton--stat">&nbsp;</div>
                  <div className="pool__stat-label">LP Supply</div>
                </div>
                <div>
                  <div className="pool__stat-value skeleton skeleton--stat">&nbsp;</div>
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
        <section className="verify container reveal" aria-label="On-chain verification">
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
