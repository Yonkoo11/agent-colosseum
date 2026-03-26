# OneChain Agent SDK Bug Fixes

We audited the official `onechain-agent` SDK and found 4 bugs. Here's what was broken and how we fixed it.

---

## Bug #1: Dead Swap Package (Critical)

**File:** `onechain-adapter/src/client.ts:115`
**Severity:** Critical — swap is completely non-functional

**Problem:**
```typescript
const PACKAGE_ID = "0x6882285ec1f53911dde4a78860410227eb6d494ff998441121918fac8ed60dba"
```
This package ID is hardcoded and does not exist on the OneChain testnet. Every swap call fails silently. The FACTORY_ID on line 118 is also dead.

**Impact:** No agent can trade. The core value proposition of the SDK is broken.

**Fix:** Made `ammPackageId` configurable via constructor. Our agents point to our deployed AMM.

```typescript
// Before (broken)
const PACKAGE_ID = "0x6882..."  // doesn't exist

// After (fixed)
constructor(options: { ammPackageId: string }) {
  this.ammPackageId = options.ammPackageId
}
```

---

## Bug #2: Zero Slippage Protection (High)

**File:** `onechain-adapter/src/client.ts:178`
**Severity:** High — any agent using this is vulnerable to sandwich attacks

**Problem:**
```typescript
tx.pure.u64(0), // minimum amount out
```

The `min_amount_out` parameter is hardcoded to 0. This means the swap will accept ANY output amount, including 0. On a real chain, a sandwich attacker could:
1. Front-run the agent's swap with a large buy (moving price up)
2. Let the agent's swap execute at the inflated price
3. Back-run with a sell (profiting from the price impact)

**Impact:** Agents lose funds to MEV extraction on every trade.

**Fix:** `minAmountOut` is now a required parameter. No more zero slippage.

```typescript
// Before (vulnerable)
tx.pure.u64(0) // minimum amount out

// After (protected)
tx.pure.u64(minAmountOut) // caller must specify
```

---

## Bug #3: External Bytecode Trust (High)

**File:** `onechain-adapter/src/client.ts:225`
**Severity:** High — arbitrary code execution via untrusted source

**Problem:**
```typescript
const response = await fetch("https://onepump.cc/api/token/compile", {
  method: "POST",
  body: JSON.stringify({ name, symbol, decimals, icon, description })
})
const { modules, dependencies } = resJson.data
const [upgradeCap] = tx.publish({ modules, dependencies })
```

The `deployCoin` function sends token metadata to an external API (`onepump.cc`), receives compiled Move bytecode, and publishes it directly to chain without any verification. The agent trusts whatever bytecode the API returns.

A compromised or malicious API could return bytecode that:
- Drains the deployer's wallet
- Creates a backdoored token contract
- Executes arbitrary Move operations

**Impact:** Any agent calling `deployCoin` could have their wallet drained.

**Fix:** Removed this function entirely. Our agents use pre-deployed, audited contracts. For token creation, we provide a local compilation path using the `one move build` CLI.

---

## Bug #4: Silent Tool Call Dropping (Medium)

**File:** `agent-runtime/src/AgentRuntime.ts:41`
**Severity:** Medium — agents silently lose capabilities

**Problem:**
```typescript
const toolCall = message.tool_calls[0]
```

When the LLM returns multiple tool calls (e.g., "check balance AND check pool reserves"), only the first one executes. The rest are silently dropped. The agent then sends incomplete results back to the LLM, which doesn't know its other requests were ignored.

**Impact:** Agents make decisions with incomplete information. Multi-step operations fail silently.

**Fix:** Loop over all tool_calls and execute each one.

```typescript
// Before (drops tool calls)
const toolCall = message.tool_calls[0]
// ...single execution...

// After (executes all)
for (const toolCall of message.tool_calls) {
  const args = JSON.parse(toolCall.function.arguments)
  const result = await this.registry.execute(toolCall.function.name, args, ctx)
  toolResults.push({
    role: "tool",
    tool_call_id: toolCall.id,
    content: JSON.stringify(result),
  })
}
```
