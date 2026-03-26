import OpenAI from "openai"
import { SkillRegistry } from "./SkillRegistry.js"
import { SkillContext } from "./types.js"

/**
 * Fixed AgentRuntime: processes ALL tool_calls, not just the first one.
 * Original bug: onechain-agent/packages/agent-runtime/src/AgentRuntime.ts:41
 * `const toolCall = message.tool_calls[0]` — silently dropped all but first tool call.
 */
export class AgentRuntime {
  private _openai: OpenAI | null = null
  private openaiApiKey?: string

  constructor(
    private registry: SkillRegistry,
    private systemPrompt: string,
    openaiApiKey?: string,
  ) {
    this.openaiApiKey = openaiApiKey
  }

  private get openai(): OpenAI {
    if (!this._openai) {
      this._openai = new OpenAI({
        apiKey: this.openaiApiKey || process.env.OPENAI_API_KEY,
      })
    }
    return this._openai
  }

  async chat(messages: any[], ctx: SkillContext): Promise<any> {
    const tools = this.registry.getToolDefinitions()
    const maxRounds = 5 // prevent infinite loops

    let currentMessages: any[] = [
      { role: "system", content: this.systemPrompt },
      ...messages,
    ]

    for (let round = 0; round < maxRounds; round++) {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 1000,
        messages: currentMessages,
        tools: tools.length > 0 ? tools : undefined,
      })

      const message = response.choices[0].message

      if (!message.tool_calls?.length) {
        // No more tool calls — LLM is done
        return message
      }

      // Execute ALL tool calls in this round
      const toolResults: any[] = []
      for (const toolCall of message.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments)
        let result: any
        try {
          result = await this.registry.execute(toolCall.function.name, args, ctx)
        } catch (execError: any) {
          result = { error: execError.message || "Tool execution failed" }
        }
        toolResults.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: typeof result === "string" ? result : JSON.stringify(result),
        })
      }

      // Append assistant message + tool results, loop for next round
      currentMessages = [...currentMessages, message, ...toolResults]
    }

    // Hit max rounds — do one final call without tools to get a text response
    const final = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: currentMessages,
    })
    return final.choices[0].message
  }
}
