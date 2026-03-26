import { Skill, SkillContext } from "./types.js"

export class SkillRegistry {
  private skills = new Map<string, Skill>()

  register(skill: Skill) {
    this.skills.set(skill.name, skill)
  }

  getToolDefinitions() {
    return Array.from(this.skills.values()).map(skill => ({
      type: "function" as const,
      function: {
        name: skill.name,
        description: skill.description,
        parameters: skill.parameters,
      },
    }))
  }

  async execute(name: string, args: any, ctx: SkillContext) {
    const skill = this.skills.get(name)
    if (!skill) throw new Error(`Skill not found: ${name}`)
    return skill.execute(args, ctx)
  }
}
