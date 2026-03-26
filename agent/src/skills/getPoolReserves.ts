import { Skill } from "../types.js"
import { OneChainClient } from "../OneChainClient.js"

export function createGetPoolReservesSkill(client: OneChainClient): Skill {
  return {
    name: "getPoolReserves",
    description:
      "Get the current reserves and price of a liquidity pool. Returns reserve_x, reserve_y, and the current price (Y per X).",
    parameters: {
      type: "object",
      properties: {
        poolId: { type: "string", description: "The pool object ID (optional, uses default pool)" },
      },
      required: [],
    },
    async execute(args, ctx) {
      const poolId = (args.poolId && args.poolId.startsWith("0x")) ? args.poolId : ctx.poolId!
      const reserves = await client.getPoolReserves(poolId)
      const price =
        reserves.reserve_x > 0
          ? reserves.reserve_y / reserves.reserve_x
          : 0
      return {
        ...reserves,
        price_y_per_x: price,
        price_x_per_y: price > 0 ? 1 / price : 0,
      }
    },
  }
}
