import { Skill } from "../types.js"
import { OneChainClient } from "../OneChainClient.js"

export function createSwapSkill(client: OneChainClient): Skill {
  return {
    name: "swapOnAmm",
    description:
      "Swap tokens on the Agent Colosseum AMM. Specify direction (x_to_y or y_to_x), the coin object ID to swap, and minimum output for slippage protection.",
    parameters: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["x_to_y", "y_to_x"],
          description: "Swap direction",
        },
        coinObjectId: {
          type: "string",
          description: "Object ID of the coin to swap",
        },
        minAmountOut: {
          type: "number",
          description: "Minimum output amount (slippage protection)",
        },
        poolId: { type: "string", description: "Pool object ID (optional, uses default)" },
        typeX: { type: "string", description: "Type of token X" },
        typeY: { type: "string", description: "Type of token Y" },
      },
      required: ["direction", "coinObjectId", "minAmountOut"],
    },
    async execute(args, ctx) {
      if (!ctx.wallet) return { error: "Wallet not configured" }

      const poolId = args.poolId || ctx.poolId!
      const typeX = args.typeX || `${ctx.ammPackageId}::cola::COLA`
      const typeY = args.typeY || `${ctx.ammPackageId}::water::WATER`

      if (args.direction === "x_to_y") {
        return client.swapXtoY(
          ctx.wallet,
          poolId,
          typeX,
          typeY,
          args.coinObjectId,
          args.minAmountOut,
        )
      } else {
        return client.swapYtoX(
          ctx.wallet,
          poolId,
          typeX,
          typeY,
          args.coinObjectId,
          args.minAmountOut,
        )
      }
    },
  }
}
