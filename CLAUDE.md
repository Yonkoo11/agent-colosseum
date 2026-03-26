# Agent Colosseum - CLAUDE.md

## What This Is
AI agents compete as economic players on OneChain (Sui fork). Three layers:
1. Fixed onechain-agent SDK (4 bugs patched)
2. Minimal constant-product AMM (first working DEX on OneChain)
3. Agent Colosseum game — agents trade, compete, get ranked

## Hackathon
- **OneHack 3.0** — AI & GameFi Edition
- **Deadline:** March 27, 2026
- **Tracks:** AI + GameFi (targeting both)
- **Chain:** OneChain (Move-based, Sui fork)

## Tech Stack
- **Contracts:** Move (Sui Move dialect)
- **CLI:** `~/bin/one` (NOT `sui` — it's a fork)
- **SDK:** `@onelabs/sui` v1.26.2 (NOT `@mysten/sui`)
- **Agent runtime:** TypeScript (forked onechain-agent)
- **Frontend:** Next.js
- **Testnet:** https://rpc-testnet.onelabs.cc

## Critical Constraints
- party.move is DEAD — do not use multi-party permissions
- funds_accumulator.move is WIP — do not use
- Move has no floats, no signed integers
- Use fixed-point math (scale by 1e9)
- Shared objects = consensus sequencing = slower. Minimize shared objects.
- Only AMM pool should be shared. Agent state = owned objects.

## Build Commands
```bash
one move build          # Compile Move contracts
one move test           # Run Move tests
one client publish      # Deploy to testnet
one client call         # Call on-chain functions
```

## Project Structure
```
agent-colosseum/
├── contracts/
│   ├── amm/           # Constant-product AMM (x*y=k)
│   └── colosseum/     # Game logic, leaderboard, agent registration
├── agent/             # Patched onechain-agent + custom strategies
├── app/               # Next.js frontend (leaderboard, visualization)
├── ai/                # Memory, progress, plans
└── CLAUDE.md          # This file
```

## Research Context
See ~/Projects/real-problems-and-products.md for competitive landscape and fatal flaw analysis.
The 4 agent framework bugs are documented in ai/memory.md with exact file:line references.

# Vibecoder Mode - Paste this into any project's CLAUDE.md

## Communication Rules

This project is built by someone who describes what they want in plain English. All responses and progress updates must follow these rules:

### Banned developer jargon (never use these with the user)
- "commit" → say "save point"
- "push" / "deploy" → say "publish"
- "branch" → say "version"
- "merge" → say "combine" or just don't mention it
- "PR" / "pull request" → say "change proposal"
- "HEAD" / "ref" / "SHA" → never mention
- "npm" / "pip" / "cargo" → never mention
- "diff" / "patch" → say "changes"
- "build" / "compile" → say "prepare"
- "lint" / "format" → just do it silently
- "repo" / "repository" → say "project"
- "CLI" / "terminal" / "shell" → say "command line" only if necessary
- "env" / "environment variable" → say "setting"
- "dependency" / "package" → say "tool" or "library" only if necessary

### Progress updates
When updating `ai/progress.md`, always include a "What Changed (Plain English)" section:
- Describe what the app does differently now
- Focus on what the user would SEE or EXPERIENCE
- Example: "The app now shows a login screen when you open it" not "Added auth middleware and login route"

### Auto-save
After completing each task:
- Save your work automatically (no asking "should I save?")
- Include a short description of what changed
- Never ask the user about saving, versioning, or publishing unless they bring it up

### When reporting progress
- Lead with what the user can see/do that they couldn't before
- Skip internal details (file names, function names, config changes)
- If something broke, say what stopped working, not what code errored

## Design Standards

All UI work in this project MUST use the installed design skills. No generic AI output.

### For new UI or full redesigns
Use `/frontend-design new` or `/frontend-design revamp`. This generates 3 structurally different proposals using the DNA system. The user picks one, then it gets built.

### For improving existing UI
Use `/ui-revamp`. This runs a 4-phase audit (audit → plan → implement → validate) using rules from Linear, Vercel, and Refactoring UI.

### For quick polish
Use `/frontend-design polish`. Lighter than a full revamp.

### Before shipping any UI
Run `/frontend-design qa`. Automated checks + manual review. Must pass before publishing.

### Zero tolerance
- No `transition: all`, no linear easing, no scale(0)
- No emojis in UI, no decorative blobs, no 3-column icon grids
- No hardcoded colors or spacing (everything from CSS variables)
- Max 2 border-radius values across the whole app
- Every interactive element needs focus, hover, and active states
