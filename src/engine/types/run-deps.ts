import type { Pricing, ProviderChainRegistry } from '@/ai/api'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { EventBus } from '@/core/events'
import type { AgentId, SessionId } from '@/core/ids'
import type { LLMMessage } from '@/core/llm'
import type { Logger } from '@/core/logging/logger'
import type { ToolDefinition } from '@/core/tool'
import type { AgentPauseStore } from '@/core/types/agent-pause'
import type { LLMUsageTotals } from '@/core/types/usage'
import type { RunTracker } from '@/engine/run-registry'
import type { AgentProfile } from '@/engine/types/agent'
import type {
  CostTracker,
  LLMAttemptSink,
  RateLimiter,
  UnrecordedSpendLog,
} from '@/engine/types/cost'
import type { Compactor, Hooks, RunInput, RunOptions, ToolExecutor } from '@/engine/types/run'

export interface RunOnceDeps {
  readonly agents: ReadonlyMap<string, AgentProfile>
  readonly tools: ReadonlyMap<string, ToolDefinition>
  readonly chains: ProviderChainRegistry
  readonly hooks: Hooks
  readonly compactor: Compactor
  readonly executor: ToolExecutor
  readonly costTracker: CostTracker
  readonly llmAttemptSink: LLMAttemptSink
  readonly unrecordedSpend: UnrecordedSpendLog
  readonly pricing: Pricing
  readonly rateLimiter: RateLimiter
  readonly logger: Logger
  readonly bus: EventBus
  readonly registry: RunTracker
  readonly config: ResolvedConfig
  /** Frozen boot-computed process env allowlist; per-run HOME/TMPDIR are layered on top. */
  readonly childEnvBase: Readonly<Record<string, string>>
  readonly shutdownSignal: AbortSignal
  /**
   * Prior transcript of the session, injected by the composition root (engine cannot reach
   * persistence). Absent = every run starts cold, which is what a one-shot caller wants.
   */
  readonly history?: (sessionId: SessionId, limit: number) => Promise<readonly LLMMessage[]>
  /**
   * Cumulative session totals to seed a resumed run with, so the session's stored totals describe
   * the conversation aggregate, not just the latest run. Absent = totals start at zero.
   */
  readonly priorTotals?: (sessionId: SessionId) => Promise<LLMUsageTotals>
  /** Which agents are paused, injected like `priorTotals`. Absent = no agent can be paused. */
  readonly agentPauses?: Pick<AgentPauseStore, 'isPaused'>
  /**
   * What an agent has spent today, injected like `priorTotals` (engine cannot reach persistence).
   * Absent = no per-agent cap is enforced.
   */
  readonly agentSpentToday?: (agentId: AgentId, nowMs: number) => Promise<number>
  /** Optional composition-owned session override. It may clone the profile but never mutate it. */
  readonly agentForRun?: (input: RunInput, fallback: AgentProfile) => AgentProfile
}

export type RunOnceOptions = RunOptions
