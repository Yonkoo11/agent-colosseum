# Agent Colosseum

AI agents compete by trading on a constant-product AMM deployed on OneChain.

We audited the official `onechain-agent` SDK, found it broken in 4 ways, fixed it, built the DEX the ecosystem was missing, and then built a game where AI agents compete using both.

## What We Built

### Layer 1: Fixed Agent SDK
The official `onechain-agent` has 4 bugs that make it non-functional:
1. **Dead swap package** — hardcoded package ID doesn't exist on testnet (Critical)
2. **Zero slippage protection** — `min_amount_out = 0` on every swap (High)
3. **Untrusted bytecode execution** — publishes arbitrary bytecode from external API (High)
4. **Silent tool call dropping** — only first LLM tool call executed, rest ignored (Medium)

Full details with before/after code: [`docs/bug-fixes.md`](docs/bug-fixes.md)

### Layer 2: Constant-Product AMM
OneChain has no working DEX. We built one:
- Standard x*y=k AMM with 0.3% fee
- All arithmetic in u128 to prevent overflow
- Minimum liquidity lock to prevent zero-division attacks
- Slippage protection on every swap
- 20 unit tests covering math, swaps, liquidity, invariants, edge cases

### Layer 3: Agent Colosseum
AI agents with different trading strategies compete in an arena:
- **MomentumBot** — buys when price rises, sells when it falls
- **MeanRevBot** — trades against deviations from anchor price
- **MMBot** — rebalances toward 50/50 exposure

Agents make decisions via OpenAI tool calling, execute trades on the real AMM, and results are tracked on-chain.

## Project Structure

```
agent-colosseum/
├── contracts/
│   ├── amm/                 # Constant-product AMM (Move)
│   │   └── sources/
│   │       ├── pool.move    # Core AMM: create, swap, add/remove liquidity
│   │       ├── cola.move    # COLA test token
│   │       └── water.move   # WATER test token
│   └── colosseum/           # Competition game logic (Move)
│       └── sources/
│           └── arena.move   # Arena, agent profiles, PnL tracking
├── agent/                   # Fixed agent SDK + trading framework (TypeScript)
│   └── src/
│       ├── AgentRuntime.ts  # Fixed: all tool_calls execute
│       ├── OneChainClient.ts # Fixed: configurable package, required slippage
│       ├── skills/          # AMM trading skills
│       ├── strategies/      # Momentum, Mean Reversion, Market Maker
│       └── run-competition.ts # Competition orchestrator
├── app/                     # Next.js frontend (leaderboard, pool view)
├── docs/
│   └── bug-fixes.md         # Detailed bug documentation
└── scripts/
    ├── deploy.sh            # Contract deployment
    └── deployed.json        # Testnet object IDs
```

## Quick Start

### Build & Test Contracts
```bash
cd contracts/amm && ~/bin/one move test    # 20 tests pass
cd contracts/colosseum && ~/bin/one move test  # 6 tests pass
```

### Run Competition Demo
```bash
cd agent
npm install
npm run build
ROUNDS=5 node dist/run-competition.js
```

### Deploy to Testnet
```bash
./scripts/deploy.sh
```

### Frontend
```bash
cd app
npm install
npm run dev    # http://localhost:3000
```

## Tech Stack
- **Smart Contracts:** Move (Sui Move dialect on OneChain)
- **Agent Runtime:** TypeScript + OpenAI tool calling
- **Frontend:** Next.js + Tailwind CSS
- **Blockchain:** OneChain testnet (Sui fork)

## Test Results

**AMM (20 tests):**
- Math: sqrt edge cases, swap formula verification, fee calculation
- Integration: pool creation, both swap directions, add/remove liquidity
- Invariants: k only increases after swaps, LP supply matches liquidity
- Edge cases: slippage protection, zero input abort, large/small swaps, sequential swaps

**Colosseum (6 tests):**
- Arena creation, agent registration, trade recording, round management, prize distribution, capacity limits

**Agent SDK (13 tests):**
- Bug #1 fix: configurable package ID
- Bug #2 fix: required slippage parameter
- Bug #4 fix: all tool calls execute
- Tool definition format (OpenAI compatible)
- Balance parsing: flat, nested struct, null/undefined

**Total: 39 tests, all passing.**

## Deployed on Testnet

All contracts are live on OneChain testnet (`https://rpc-testnet.onelabs.cc`).

| Object | ID |
|--------|----|
| AMM Package | `0xf5b9c384661a84b5a9ae339a4eadfea085886e33256be4d2ff722b0a2c8392b7` |
| COLA/WATER Pool | `0x79022dd6d0f9b9008e56ae55ca8edcd7b4f06f675d6215090b060eb55aeedecc` |
| Colosseum Package | `0x5a4d979fd8374529f432ca846b7d91371722a439bb8215720538c13a3df87c2f` |
| Arena | `0xf9830ccbce88ce83198b6bd36fe50fb2b6ac102d1b2ea07b8fa61df74264a813` |
| MomentumBot Profile | `0x7f707c63d0fde46a2ec3cd12c7919b342b5ab9a6a1787cff3a6aec99e3cec8cd` |
| MeanRevBot Profile | `0xc6aab2c99be7c071d67acde8672c55951b34b4a9d7c1255cdc68b61e7131648a` |
| MMBot Profile | `0x094aeb73c256271fe284e389b533295122369c1b5f4024b6bda2bdfeb169ea61` |

**Verified on-chain swap:** 1,000,000 COLA → 996,900 WATER (0.31% cost = 0.3% fee + price impact).

All IDs also in [`scripts/deployed.json`](scripts/deployed.json).

## Hackathon
- **OneHack 3.0** — AI & GameFi Edition
- **Chain:** OneChain (Move-based L1, Sui fork)
- **Tracks:** AI + GameFi
