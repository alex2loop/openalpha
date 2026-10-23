import type { ChannelId } from '@/core/channels'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { TaskPassListener } from '@/core/container'
import type { AgentId, JobId, UserId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { RunInput, Runner, RunResult } from '@/engine/api'
import type { EventFireClaim, EventJobMatch, JobEvent } from '@/scheduler/event/types'

export interface DeliverySink {
  notify(target: DeliveryTarget, text: string): Promise<void>
}

export interface DeliveryTarget {
  readonly channel: ChannelId
  readonly chatId: string
}

// Fire times are machine instants: epoch-ms numbers end to end (two-tier time convention).
export type JobSchedule =
  | { readonly kind: 'cron'; readonly expr: string; readonly timezone: string }
  | { readonly kind: 'interval'; readonly everyMs: number }
  | { readonly kind: 'once'; readonly at: number }

export interface JobOwner {
  readonly userId: UserId
  readonly channel: ChannelId
  readonly chatId: string
}

export interface Job {
  readonly id: JobId
  readonly agentId: AgentId
  readonly prompt: string
  readonly allowedTools?: readonly string[]
  readonly schedule: JobSchedule
  readonly target?: DeliveryTarget
  readonly enabled: boolean
  readonly nextRunAt: number
  readonly consecutiveFailures: number
  readonly owner?: JobOwner
  /** Set on an event job, which runs when an alert fires and has no time of its own. */
  readonly event?: JobEvent
}

export interface JobStore {
  /** `runNowClaimStaleBeforeMs`: a row whose run-now claim predates this is due despite the claim
   *  -- a process that died mid-run-now must not pause the job's own cadence indefinitely. */
  due(nowMs: number, limit: number, runNowClaimStaleBeforeMs: number): Promise<readonly Job[]>
  advance(id: JobId, nextRunAt: number): Promise<void>
  disable(id: JobId): Promise<void>
  create(job: Job): Promise<boolean>
  put(job: Job): Promise<void>
  list(): Promise<readonly Job[]>
  find(id: JobId): Promise<Job | undefined>
  findByPrefix(prefix: string, limit: number): Promise<readonly Job[]>
  remove(id: JobId): Promise<void>
  pause(id: JobId): Promise<boolean>
  resume(id: JobId, nextRunAt: number): Promise<boolean>
  deferRetry(id: JobId, failures: number, nextRunAt: number): Promise<void>
  listOwned(owner: JobOwner): Promise<readonly Job[]>
  findOwned(owner: JobOwner, id: JobId): Promise<Job | undefined>
  findOwnedByPrefix(owner: JobOwner, prefix: string, limit: number): Promise<readonly Job[]>
  pauseOwned(owner: JobOwner, id: JobId): Promise<boolean>
  resumeOwned(owner: JobOwner, id: JobId, nextRunAt: number): Promise<boolean>
  claimRunNow(id: JobId, token: string, claimedAtMs: number): Promise<Job | undefined>
  releaseRunNowClaim(id: JobId, token: string): Promise<void>
  claimRunNowOwned(
    owner: JobOwner,
    id: JobId,
    token: string,
    claimedAtMs: number
  ): Promise<Job | undefined>
  releaseRunNowClaimOwned(owner: JobOwner, id: JobId, token: string): Promise<void>
  clearRunNowClaims(claimedBeforeMs: number): Promise<void>
  /** Enabled event jobs this alert starts. */
  matchEvent(match: EventJobMatch): Promise<readonly Job[]>
  /** True when the job's last fire is a full cooldown old, and records this one in the same step. */
  claimEventFire(claim: EventFireClaim): Promise<boolean>
}

export type SchedulerCommandResult =
  | { readonly kind: 'job'; readonly job: Job }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'rejected' }

export interface SchedulerRunNowInput {
  /** Absent for the local operator console, which manages jobs regardless of who created them. */
  readonly owner?: JobOwner
  readonly idOrPrefix: string
  readonly requestId: string
  /** Added to the job's prompt for this run only. The caller has rendered and validated it. */
  readonly appendPrompt?: string
  /** Cancels the run. The daemon passes its shutdown signal; the CLI passes the command's. */
  readonly signal: AbortSignal
}

export interface SchedulerCommands {
  list(owner: JobOwner): Promise<readonly Job[]>
  show(owner: JobOwner, idOrPrefix: string): Promise<SchedulerCommandResult>
  pause(owner: JobOwner, idOrPrefix: string): Promise<SchedulerCommandResult>
  resume(owner: JobOwner, idOrPrefix: string): Promise<SchedulerCommandResult>
  runNow(input: SchedulerRunNowInput): Promise<SchedulerCommandResult>
  remove(owner: JobOwner, idOrPrefix: string): Promise<SchedulerCommandResult>
  /** Owner-independent removal, for the local operator console only. */
  removeAny(idOrPrefix: string): Promise<SchedulerCommandResult>
  pauseAny(idOrPrefix: string): Promise<SchedulerCommandResult>
  resumeAny(idOrPrefix: string): Promise<SchedulerCommandResult>
}

export type SchedulerRunOutcome =
  | {
      readonly status: 'success'
      readonly endedAtMs: number
      readonly summary: string
      readonly costUsd: number
      // A paid run that completed but whose outbound notice failed. The run still counts as
      // success (it ran and was billed); the delivery error is recorded for visibility only.
      readonly deliveryError?: string
    }
  | {
      readonly status: 'failed'
      readonly endedAtMs: number
      readonly errorMessage: string
      /** The unset key variable that stopped the run: the job is healthy and waits for a restart. */
      readonly missingEnv?: string
    }

export type SchedulerOccurrenceClaim =
  | { readonly kind: 'claimed'; readonly runId: number; readonly token: string }
  | {
      readonly kind: 'already_claimed'
      readonly status: 'running' | 'success' | 'failed'
      readonly runId: number
      /** Only meaningful for `status: 'running'`; null on a row claimed before leases existed. */
      readonly leaseUntilMs: number | null
    }
  | { readonly kind: 'missing' }

export type SchedulerClaim = Extract<SchedulerOccurrenceClaim, { kind: 'claimed' }>

// advance commits a success and resets the failure count; skip keeps it — a shutdown or
// approval-denied halt advances the cadence without saying anything about the job's health.
export type SchedulerJobTransition =
  | { readonly kind: 'advance'; readonly nextRunAt: number }
  | { readonly kind: 'skip'; readonly nextRunAt: number }
  | { readonly kind: 'disable' }
  | { readonly kind: 'retry'; readonly failures: number; readonly nextRunAt: number }

interface SchedulerOccurrenceFinalization {
  readonly runId: number
  readonly token: string
  readonly jobId: JobId
  readonly outcome: SchedulerRunOutcome
  readonly transition: SchedulerJobTransition
}

interface SchedulerOccurrenceStore {
  /** Claim a scheduled occurrence. A returned run id is paired with the token for finalization. */
  claim(options: {
    readonly jobId: JobId
    readonly scheduledFor: number
    readonly token: string
    readonly startedAtMs: number
    readonly leaseUntilMs: number
  }): Promise<SchedulerOccurrenceClaim>
  /** Commit the outcome and apply the requested job transition atomically. */
  finalize(input: SchedulerOccurrenceFinalization): Promise<boolean>
  /** Close a 'running' row by id, no job transition. Recovery uses it when finalization was lost. */
  finish(runId: number, outcome: SchedulerRunOutcome): Promise<void>
  /** Extend a live claim's lease. Best-effort: a lost lease (wrong token/status) is a silent no-op. */
  renewLease(runId: number, token: string, leaseUntilMs: number): Promise<void>
  /** Record a delivery failure on a run that already succeeded. */
  recordDeliveryError(runId: number, errorMessage: string): Promise<void>
  /** Open a run-now row, returning its history id. */
  startRunNow(jobId: JobId, requestId: string, startedAtMs: number): Promise<number>
  /** Close a run-now row. */
  finishRunNow(runId: number, outcome: SchedulerRunOutcome): Promise<void>
  /** Boot-time: a row still 'running' belongs to a daemon that died mid-job. */
  markStale(nowMs: number): Promise<number>
}

// Consumer-side interface: `persistence` implements it, `app` binds it (as JobStore does).
export interface SchedulerDeps {
  /** Told each tick of the scheduler's own loop. */
  readonly onTaskPass: TaskPassListener
  readonly jobStore: JobStore
  readonly runner: Runner
  readonly occurrences: SchedulerOccurrenceStore
  readonly notifier: DeliverySink
  readonly logger: Logger
  readonly config: ResolvedConfig
  readonly runInput: (job: Job) => RunInput
  /** Surface-owned localized rendering for the operator-facing auto-disable notice. */
  readonly renderAutoDisableNotice: (jobId: JobId, consecutiveFailures: number) => string
  /** Surface-owned localized rendering for a run that stopped early with part of an answer. */
  readonly renderPartialNotice: (result: RunResult) => string
  /** Where a target-less job's output goes; undefined = drop it. Late-bound until channels start. */
  readonly defaultTarget: () => DeliveryTarget | undefined
  /** Where disabled-job alerts go, independently from the job's potentially broken target. */
  readonly failureTarget: () => DeliveryTarget | undefined
  /** Told when an event job is removed, with the alert it was armed with. */
  readonly onEventJobRemoved?: (alertId: string) => Promise<void>
}
