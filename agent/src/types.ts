import { Keypair } from "@onelabs/sui/cryptography"

export interface SkillContext {
  userAddress: string
  wallet?: Keypair
  ammPackageId: string
  colosseumPackageId: string
  poolId?: string
  arenaId?: string
  agentProfileId?: string
}

export interface Skill {
  name: string
  description: string
  parameters: any
  execute(args: any, ctx: SkillContext): Promise<any>
}
