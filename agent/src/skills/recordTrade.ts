import { Skill } from "../types.js"
import { OneChainClient } from "../OneChainClient.js"
import { Transaction } from "@onelabs/sui/transactions"

export function createRecordTradeSkill(client: OneChainClient): Skill {
  return {
    name: "recordTrade",
    description:
      "Record a trade result on-chain. Call this after each swap to update your agent profile with new balances and current price.",
    parameters: {
      type: "object",
      properties: {
        new_balance_x: { type: "number", description: "New X token balance after trade" },
        new_balance_y: { type: "number", description: "New Y token balance after trade" },
        price_y_per_x: {
          type: "number",
          description: "Current price of X in Y terms, scaled by 1e9",
        },
      },
      required: ["new_balance_x", "new_balance_y", "price_y_per_x"],
    },
    async execute(args, ctx) {
      if (!ctx.wallet) return { error: "Wallet not configured" }
      if (!ctx.agentProfileId) return { error: "Agent profile ID not configured" }

      const tx = new Transaction()
      tx.moveCall({
        target: `${ctx.colosseumPackageId}::arena::record_trade`,
        arguments: [
          tx.object(ctx.agentProfileId),
          tx.pure.u64(args.new_balance_x),
          tx.pure.u64(args.new_balance_y),
          tx.pure.u64(args.price_y_per_x),
        ],
      })

      const result = await client.getSuiClient().signAndExecuteTransaction({
        transaction: tx,
        signer: ctx.wallet,
        options: { showEffects: true },
      })

      return {
        success: true,
        txHash: result.digest,
      }
    },
  }
}
