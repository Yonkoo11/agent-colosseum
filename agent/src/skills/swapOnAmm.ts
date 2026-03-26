import { Skill } from "../types.js"
import { OneChainClient } from "../OneChainClient.js"
import { Transaction } from "@onelabs/sui/transactions"

export function createSwapSkill(client: OneChainClient): Skill {
  return {
    name: "swapOnAmm",
    description:
      "Swap tokens on the AMM. Specify direction (x_to_y or y_to_x), the amount to swap, and minimum output for slippage protection. Uses your wallet's token balance automatically.",
    parameters: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["x_to_y", "y_to_x"],
          description: "Swap direction: x_to_y sells COLA for WATER, y_to_x sells WATER for COLA",
        },
        amount: {
          type: "number",
          description: "Amount of input token to swap (in base units with 9 decimals, e.g. 1000000000 = 1 token)",
        },
        minAmountOut: {
          type: "number",
          description: "Minimum output amount (slippage protection, in base units)",
        },
      },
      required: ["direction", "amount", "minAmountOut"],
    },
    async execute(args, ctx) {
      if (!ctx.wallet) return { error: "Wallet not configured" }

      const poolId = ctx.poolId!
      const typeX = `${ctx.ammPackageId}::cola::COLA`
      const typeY = `${ctx.ammPackageId}::water::WATER`
      const suiClient = client.getSuiClient()
      const address = ctx.wallet.toSuiAddress()

      try {
        const inputCoinType = args.direction === "x_to_y" ? typeX : typeY

        // Fetch wallet's coins of the input type
        const coins = await suiClient.getCoins({ owner: address, coinType: inputCoinType })
        if (!coins.data.length) {
          return { error: `No ${args.direction === "x_to_y" ? "COLA" : "WATER"} coins in wallet` }
        }

        const tx = new Transaction()

        // Merge all coins into one, then split the swap amount
        const coinIds = coins.data.map((c) => c.coinObjectId)
        let primaryCoin = tx.object(coinIds[0])
        if (coinIds.length > 1) {
          tx.mergeCoins(primaryCoin, coinIds.slice(1).map((id) => tx.object(id)))
        }
        const [swapCoin] = tx.splitCoins(primaryCoin, [args.amount])

        const target = args.direction === "x_to_y"
          ? `${ctx.ammPackageId}::pool::swap_x_to_y_entry`
          : `${ctx.ammPackageId}::pool::swap_y_to_x_entry`

        tx.moveCall({
          target,
          typeArguments: [typeX, typeY],
          arguments: [
            tx.object(poolId),
            swapCoin,
            tx.pure.u64(args.minAmountOut),
          ],
        })

        const result = await suiClient.signAndExecuteTransaction({
          transaction: tx,
          signer: ctx.wallet,
          options: { showEffects: true, showBalanceChanges: true },
        })

        return {
          success: true,
          txHash: result.digest,
          balanceChanges: result.balanceChanges,
        }
      } catch (err: any) {
        return { error: err.message || "Swap failed" }
      }
    },
  }
}
