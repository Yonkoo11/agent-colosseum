import { SkillRegistry } from "./SkillRegistry.js"
import { AgentRuntime } from "./AgentRuntime.js"
import { OneChainClient } from "./OneChainClient.js"
import { SkillContext } from "./types.js"
import { createGetPoolReservesSkill } from "./skills/getPoolReserves.js"
import { createSwapSkill } from "./skills/swapOnAmm.js"
import { createGetBalanceSkill } from "./skills/getBalance.js"
import { createRecordTradeSkill } from "./skills/recordTrade.js"

export interface AgentConfig {
  name: string
  systemPrompt: string
  ammPackageId: string
  colosseumPackageId: string
  poolId: string
  arenaId?: string
  agentProfileId?: string
}

export function createAgent(config: AgentConfig) {
  const client = new OneChainClient({
    ammPackageId: config.ammPackageId,
  })

  const registry = new SkillRegistry()
  registry.register(createGetPoolReservesSkill(client))
  registry.register(createSwapSkill(client))
  registry.register(createGetBalanceSkill(client))
  registry.register(createRecordTradeSkill(client))

  const runtime = new AgentRuntime(registry, config.systemPrompt)

  return {
    name: config.name,
    client,
    registry,
    runtime,

    async run(prompt: string, ctx: SkillContext) {
      const messages = [{ role: "user" as const, content: prompt }]
      return runtime.chat(messages, ctx)
    },
  }
}
