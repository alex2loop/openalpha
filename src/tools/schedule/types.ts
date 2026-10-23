import type { ChannelId } from '@/core/channels'
import type { AgentId, JobId, UserId } from '@/core/ids'
import type { ToolServices } from '@/core/tool'
import type {
  AgentRegistry,
  ForegroundResearchInteraction,
  ResearchCoordinator,
  Runner,
  SkillCatalog,
} from '@/engine/api'
import type { FileRevisionGuard } from '@/tools/fs/file-revision-guard'
import type { WebRetrievalService } from '@/tools/web/retrieval-service'

export interface ScopedJobStore {
  add(scope: JobToolScope, job: ScopedNewJob): Promise<ScopedJobRow>
  list(scope: JobToolScope): Promise<readonly ScopedJobRow[]>
  resolveIdPrefix(scope: JobToolScope, idOrPrefix: string): Promise<JobId>
  remove(scope: JobToolScope, id: JobId): Promise<void>
}

// Tools-owned mirror of scheduler's JobSchedule minus 'interval' (an agent sets a time, not a
// cadence in ms). `app` maps it onto the scheduler contract.
export type ScopedNewJobSchedule =
  | { readonly kind: 'cron'; readonly expr: string; readonly timezone: string }
  | { readonly kind: 'once'; readonly atMs: number }

export interface ScopedNewJob {
  readonly prompt: string
  readonly schedule: ScopedNewJobSchedule
}

export interface JobToolScope {
  readonly agentId: AgentId
  readonly userId: UserId
  readonly channel: ChannelId
  readonly chatId?: string
  readonly tz: string
}

// `enabled: false` alone cannot say whether a job is waiting to be resumed or has already fired,
// which left the agent asking the operator to adjudicate spent one-shots. Derived, never stored.
export type ScopedJobStatus = 'scheduled' | 'paused' | 'done'

export interface ScopedJobRow {
  readonly id: JobId
  readonly status: ScopedJobStatus
  readonly prompt: string
  /** Absent on an event job, which runs when an alert fires and has no time of its own. */
  readonly nextRunAt?: number
  readonly cronExpr?: string
  /** What starts an event job. */
  readonly onEvent?: 'stop' | 'target' | 'price' | 'mover'
}

// core/tool.ts declares `ToolServices` empty so that core keeps no edge to engine or tools.
// Each tool group augments it with the handle it needs; the composition root binds the value.
declare module '@/core/tool' {
  interface ToolServices {
    readonly agents: AgentRegistry
    readonly runner: Runner
    readonly research: ResearchCoordinator
    readonly jobs: ScopedJobStore
    readonly skillCatalog: SkillCatalog
    readonly fileRevisionGuard: FileRevisionGuard
    readonly webRetrieval: WebRetrievalService
  }
}

// The run-to-tool research seam is tools-owned: core names no research vocabulary, and the
// executor passes the run's optional interaction straight through.
declare module '@/core/tool' {
  interface ToolInvocationContext {
    readonly researchInteraction?: ForegroundResearchInteraction
  }
}

declare module '@/core/container' {
  interface Services {
    toolServices: ToolServices
    webRetrieval: WebRetrievalService
  }
}
