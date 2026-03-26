const RPC = "https://rpc-testnet.onelabs.cc"
const POOL_ID = "0x79022dd6d0f9b9008e56ae55ca8edcd7b4f06f675d6215090b060eb55aeedecc"
const AMM_PACKAGE = "0xf5b9c384661a84b5a9ae339a4eadfea085886e33256be4d2ff722b0a2c8392b7"

export interface PoolData {
  reserve_x: number
  reserve_y: number
  lp_supply: number
  fee_bps: number
  price: number
}

// OneChain tokens use 9 decimal places
export const TOKEN_SCALE = 1_000_000_000

function extractValue(field: any): number {
  if (typeof field === "number" || typeof field === "string") return Number(field)
  if (field?.fields?.value !== undefined) return Number(field.fields.value)
  return 0
}

export async function fetchPoolData(): Promise<PoolData | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sui_getObject",
        params: [POOL_ID, { showContent: true }],
      }),
    })

    const json = await res.json()
    const fields = json?.result?.data?.content?.fields
    if (!fields) return null

    const rx = extractValue(fields.reserve_x)
    const ry = extractValue(fields.reserve_y)

    return {
      reserve_x: rx,
      reserve_y: ry,
      lp_supply: extractValue(fields.lp_supply),
      fee_bps: Number(fields.fee_bps),
      price: rx > 0 ? ry / rx : 0,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

const PNL_OFFSET = BigInt("1000000000000000000") // 1e18

const AGENT_IDS = [
  { id: "0x7f707c63d0fde46a2ec3cd12c7919b342b5ab9a6a1787cff3a6aec99e3cec8cd", strategy: "Momentum", color: "#6366f1" },
  { id: "0xc6aab2c99be7c071d67acde8672c55951b34b4a9d7c1255cdc68b61e7131648a", strategy: "Mean Reversion", color: "#22c55e" },
  { id: "0x094aeb73c256271fe284e389b533295122369c1b5f4024b6bda2bdfeb169ea61", strategy: "Market Maker", color: "#eab308" },
]

export interface AgentData {
  name: string
  strategy: string
  color: string
  balance_x: number
  balance_y: number
  pnl: number // raw offset from 1e18, as a number
  trades: number
  wins: number
  initial_value: number
  objectId: string
}

function decodeName(nameArr: number[]): string {
  return nameArr.map((c) => String.fromCharCode(c)).join("")
}

export async function fetchAgents(): Promise<AgentData[]> {
  try {
    const results = await Promise.all(
      AGENT_IDS.map(async (agent) => {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10_000)
        try {
          const res = await fetch(RPC, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "sui_getObject",
              params: [agent.id, { showContent: true }],
            }),
          })
          const json = await res.json()
          const fields = json?.result?.data?.content?.fields
          if (!fields) return null

          const pnlField = fields.cumulative_pnl
          if (pnlField === undefined || pnlField === null) return null
          const pnlRaw = BigInt(pnlField)
          const pnlDelta = Number(pnlRaw - PNL_OFFSET)

          return {
            name: decodeName(fields.name),
            strategy: agent.strategy,
            color: agent.color,
            balance_x: Number(fields.balance_x),
            balance_y: Number(fields.balance_y),
            pnl: pnlDelta,
            trades: Number(fields.trades),
            wins: Number(fields.wins),
            initial_value: Number(fields.initial_value),
            objectId: agent.id,
          }
        } finally {
          clearTimeout(timeout)
        }
      })
    )
    return results.filter((a): a is AgentData => a !== null)
  } catch {
    return []
  }
}

export { POOL_ID, AMM_PACKAGE, RPC }
