import type { AgentId } from '@/core/ids'
import type { ProviderModelId, ReasoningMode } from '@/core/llm'

export interface AgentRegistry {
  get(id: string): AgentProfile | null
  all(): readonly AgentProfile[]
}

export type AgentModelChain =
  | { readonly kind: 'primary' }
  | { readonly kind: 'tier'; readonly name: string }

export interface AgentProfile {
  readonly id: AgentId
  readonly name: string
  readonly description?: string
  readonly systemPrompt: string
  readonly model: string
  /** Session-scoped runtime preference; configured profiles leave this absent. */
  readonly preferredProviderModel?: ProviderModelId
  readonly modelChain: AgentModelChain
  readonly reasoningMode: ReasoningMode
  readonly tools: readonly string[]
  readonly maxTurns: number
  readonly maxTokens?: number
  readonly maxDurationMs?: number
  /** Raw `[focus]` table. Trading validates it at boot; the engine never reads inside it. */
  readonly focus?: Readonly<Record<string, unknown>>
  /** This agent's own daily spend ceiling, under `[budget].max_daily_usd`. Absent = only that cap. */
  readonly maxDailyUsd?: number
  readonly delegates: readonly string[]
  /** Child agents it may have working at once through `spawn`. Absent = it may not spawn. */
  readonly maxSpawn?: number
  /** Omitted = any host the SSRF policy allows; present = web_fetch hosts must match one entry. */
  readonly hosts?: readonly string[]
  /** Omitted = every installed skill; present = only these are listed or viewable. */
  readonly skills?: readonly string[]
}
