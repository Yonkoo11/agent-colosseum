import { Skill } from "../types.js"
import { OneChainClient } from "../OneChainClient.js"

export function createGetBalanceSkill(client: OneChainClient): Skill {
  return {
    name: "getBalance",
    description: "Get your wallet's COLA and WATER token balances.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    async execute(_args, ctx) {
      const address = ctx.wallet?.toSuiAddress() || ctx.userAddress
      const suiClient = client.getSuiClient()
      const typeX = `${ctx.ammPackageId}::cola::COLA`
      const typeY = `${ctx.ammPackageId}::water::WATER`

      const [balX, balY, balOct] = await Promise.all([
        suiClient.getBalance({ owner: address, coinType: typeX }),
        suiClient.getBalance({ owner: address, coinType: typeY }),
        suiClient.getBalance({ owner: address }),
      ])

      return {
        address,
        cola: Number(balX.totalBalance),
        water: Number(balY.totalBalance),
        oct: Number(balOct.totalBalance),
      }
    },
  }
}
