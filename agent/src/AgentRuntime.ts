import Anthropic from "@anthropic-ai/sdk"
import { SkillRegistry } from "./SkillRegistry.js"
import { SkillContext } from "./types.js"

export interface AgentRuntimeOptions {
  model?: string
  maxTokens?: number
}

/**
 * AgentRuntime using Anthropic Claude for tool-calling agent loop.
 * Processes ALL tool_use blocks per response (parallel tool calls).
 */
export class AgentRuntime {
  private _client: Anthropic | null = null
  private apiKey?: string
  private model: string
  private maxTokens: number

  constructor(
    private registry: SkillRegistry,
    private systemPrompt: string,
    apiKey?: string,
    options?: AgentRuntimeOptions,
  ) {
    this.apiKey = apiKey
    this.model = options?.model || "claude-haiku-4-5-20251001"
    this.maxTokens = options?.maxTokens || 1024
  }

  private get client(): Anthropic {
    if (!this._client) {
      this._client = new Anthropic({
        apiKey: this.apiKey || process.env.ANTHROPIC_API_KEY,
        timeout: 60_000,
      })
    }
    return this._client
  }

  private getTools(): Anthropic.Tool[] {
    return this.registry.getToolDefinitions().map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
    }))
  }

  private async callApi(
    messages: Anthropic.MessageParam[],
    tools?: Anthropic.Tool[],
  ): Promise<Anthropic.Message> {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: this.maxTokens,
      system: this.systemPrompt,
      messages,
      ...(tools && tools.length > 0 ? { tools } : {}),
    }
    try {
      return await this.client.messages.create(params)
    } catch (err: any) {
      const status = err?.status
      if (status === 429 || status === 500 || status === 529) {
        console.log(`  [AgentRuntime] Retrying after ${status}...`)
        await new Promise((r) => setTimeout(r, 2000))
        return await this.client.messages.create(params)
      }
      throw err
    }
  }

  async chat(messages: Anthropic.MessageParam[], ctx: SkillContext): Promise<Anthropic.Message> {
    const tools = this.getTools()
    const maxRounds = 5

    let currentMessages: Anthropic.MessageParam[] = [...messages]

    for (let round = 0; round < maxRounds; round++) {
      const response = await this.callApi(currentMessages, tools)

      if (response.stop_reason !== "tool_use") {
        return response
      }

      // Extract all tool_use blocks
      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use")

      // Execute all tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of toolUseBlocks) {
        if (block.type !== "tool_use") continue
        let result: any
        try {
          result = await this.registry.execute(block.name, block.input, ctx)
        } catch (execError: any) {
          result = { error: execError.message || "Tool execution failed" }
        }
        const content = typeof result === "string" ? result : JSON.stringify(result)
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content,
        })
        console.log(
          `  [Tool] ${block.name}(${JSON.stringify(block.input).slice(0, 80)}) → ${content.slice(0, 60)}`,
        )
      }

      // Append assistant response + tool results, loop
      currentMessages = [
        ...currentMessages,
        { role: "assistant" as const, content: response.content },
        { role: "user" as const, content: toolResults },
      ]
    }

    // Hit max rounds — final call without tools
    return await this.callApi(currentMessages)
  }
}
