import { Skill } from "../types.js"
import { OneChainClient } from "../OneChainClient.js"

export function createGetBalanceSkill(client: OneChainClient): Skill {
  return {
    name: "getBalance",
    description: "Get the OCT balance for an address on OneChain.",
    parameters: {
      type: "object",
      properties: {
        address: { type: "string", description: "The address to check (defaults to agent's own address)" },
      },
      required: [],
    },
    async execute(args, ctx) {
      const address = args.address || ctx.userAddress
      return client.getBalance(address)
    },
  }
}
