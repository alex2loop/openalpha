import type { AgentId, LLMAttemptId, RunId, SessionId } from '@/core/ids'
import type { LLMErrorCode, ProviderAttemptOutcome } from '@/core/llm'

const LLM_ATTEMPT_KINDS = ['turn', 'compaction', 'preference', 'external'] as const
export type LLMAttemptKind = (typeof LLM_ATTEMPT_KINDS)[number]

/** A billed non-LLM provider call. Recorded in the same ledger so one sum covers all spend. */
export interface ExternalCharge {
  readonly provider: string
  readonly operation: string
  readonly costUsd: number
}

const USAGE_SOURCES = ['provider', 'estimated'] as const
export type UsageSource = (typeof USAGE_SOURCES)[number]

const COST_SOURCES = [
  'provider_reported',
  'pricing_override',
  'pricing_subscription',
  'pricing_openrouter',
  'pricing_modelsdev',
  'pricing_local',
  'pricing_fallback',
] as const
export type CostSource = (typeof COST_SOURCES)[number]
export interface LLMUsageTotals {
  readonly costUsd: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly reasoningTokens: number
  readonly modelCalls: number
  /** The model behind every billed call, where one model served them all. Absent where several did
   *  - a fallback chain that switched, or personas configured apart - because no single name then
   *  describes the spend this total reports. */
  readonly modelName?: string
}

export const EMPTY_LLM_USAGE_TOTALS: LLMUsageTotals = Object.freeze({
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  modelCalls: 0,
})

interface LLMAttemptBase {
  readonly id: LLMAttemptId
  readonly runId: RunId
  readonly parentRunId?: RunId
  readonly agentId: AgentId
  /** The agent whose daily cap this spend counts against: the one that asked, which is not always
   *  the one that ran (a debate persona bills to the agent that started the debate). */
  readonly billingAgentId: AgentId
  readonly kind: LLMAttemptKind
  readonly provider: string
  readonly model: string
  readonly usageSource: UsageSource
  readonly costSource: CostSource
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly reasoningTokens: number
  readonly costUsd: number
  readonly latencyMs: number
  readonly settledAt: number
}

type LLMAttemptResult =
  | { readonly outcome: 'success'; readonly errorCode?: never }
  | {
      readonly outcome: Exclude<ProviderAttemptOutcome, 'success'>
      readonly errorCode: LLMErrorCode
    }

type LLMAttemptFields = LLMAttemptBase & LLMAttemptResult

export type LLMAttemptInput = LLMAttemptFields & { readonly sessionId: SessionId | null }
export interface CostRange {
  readonly fromDay: string
  readonly toDay: string
}

export interface DaySpend {
  readonly day: string
  readonly costUsd: number
}

/** What one run costs on one model: the mean over that model's most recent runs. */
export interface ModelRunCost {
  readonly provider: string
  readonly model: string
  readonly perRunUsd: number
}

/** One agent's spend on one model over a window. */
export interface SpendBreakdownRow {
  readonly agentId: AgentId
  /** Whose cap the spend counted against. */
  readonly billingAgentId: AgentId
  readonly provider: string
  readonly model: string
  readonly calls: number
  readonly failedCalls: number
  readonly costUsd: number
  /** Uncached input, as every attempt row stores it; the two cache counts are the rest. */
  readonly inputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
  /** Mean latency of the model calls that answered. Absent where none did, and for a billed search,
   *  which has no latency of its own. */
  readonly averageLatencyMs?: number
}
