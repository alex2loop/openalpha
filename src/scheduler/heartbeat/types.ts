import type { ChannelId } from '@/core/channels'
import type { AgentId, HeartbeatCommitmentId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { AgentPauseStore } from '@/core/types/agent-pause'
import type { DailyWindow } from '@/core/utils/time'
import type { AgentProfile, AgentRegistry, RunInput, Runner } from '@/engine/api'
import type { DeliverySink } from '@/scheduler/types'

export type HeartbeatSessionMode = 'shared' | 'isolated'

/** Bounds for a task the runtime adds rather than the operator's file: the tools it may use, its
 *  turns and clock, and the channel it runs on. Its own turn cap ends the visit; it is not a
 *  failure. */
export interface HeartbeatTaskRun {
  readonly allowedTools: readonly string[]
  readonly maxTurns: number
  /** Never above `HeartbeatDeps.runMaxDurationMs`, which sizes the lease; the engine clamps it too. */
  readonly maxDurationMs: number
  readonly channel: ChannelId
}

export interface HeartbeatTask {
  readonly name: string
  readonly intervalMs: number
  readonly prompt: string
  readonly deliver?: readonly string[]
  readonly session?: HeartbeatSessionMode
  readonly duplicateWindowMs?: number
  readonly run?: HeartbeatTaskRun
  /** The task may start only inside this window; outside it, it is skipped with no claim. */
  readonly activeHours?: DailyWindow
  /** `false` drops the commitments the model asks for, so nothing written under strangers'
   *  influence comes back later as a prompt. */
  readonly keepsCommitments?: false
}

export interface HeartbeatCommitmentInput {
  readonly prompt: string
  readonly dueInMs: number
}

export interface HeartbeatCommitment {
  readonly id: HeartbeatCommitmentId
  readonly taskName: string
  readonly prompt: string
  readonly dueAt: number
}

export interface NewHeartbeatCommitment {
  readonly id: HeartbeatCommitmentId
  readonly prompt: string
  readonly dueAt: number
}

interface CompleteHeartbeatTaskInput {
  readonly agentId: AgentId
  readonly taskName: string
  readonly token: string
  readonly completedAt: number
  readonly consumedCommitmentIds: readonly HeartbeatCommitmentId[]
  readonly newCommitments: readonly NewHeartbeatCommitment[]
  readonly maxPendingCommitmentsPerAgent: number
}

export type CompleteHeartbeatTaskOutcome =
  | { readonly kind: 'completed'; readonly inserted: number }
  | { readonly kind: 'lease_lost' }

interface ClaimHeartbeatTaskInput {
  readonly agentId: AgentId
  readonly taskName: string
  readonly token: string
  readonly now: number
  /** Due when the last completion is at or before this, or ahead of `now` (clock stepped back). */
  readonly dueBefore: number
  readonly leaseExpiresBefore: number
}

export type ClaimHeartbeatTaskOutcome =
  | { readonly kind: 'claimed'; readonly consecutiveFailures: number }
  | { readonly kind: 'not_claimed' }

interface ReleaseHeartbeatTaskInput {
  readonly agentId: AgentId
  readonly taskName: string
  readonly token: string
}

interface RecordHeartbeatFailureInput {
  readonly agentId: AgentId
  readonly taskName: string
  readonly token: string
  readonly nextRetryAt: number
}

interface ListDueCommitmentsInput {
  readonly agentId: AgentId
  readonly taskName: string
  readonly now: number
  readonly limit: number
}

// Consumer-side seam: scheduler owns the heartbeat policy and this interface; persistence
// implements it structurally without importing scheduler, and app binds the two.
interface HeartbeatStore {
  syncAgents(agentIds: readonly AgentId[]): Promise<void>
  syncTasks(agentId: AgentId, taskNames: readonly string[]): Promise<void>
  /** Atomically decides dueness and takes ownership. `not_claimed` = not due, or held elsewhere. */
  claimTask(input: ClaimHeartbeatTaskInput): Promise<ClaimHeartbeatTaskOutcome>
  releaseTask(input: ReleaseHeartbeatTaskInput): Promise<void>
  /** A run that did not complete: bump the failure count and defer the next claim until it. */
  recordFailure(input: RecordHeartbeatFailureInput): Promise<void>
  listDueCommitments(input: ListDueCommitmentsInput): Promise<readonly HeartbeatCommitment[]>
  completeTask(input: CompleteHeartbeatTaskInput): Promise<CompleteHeartbeatTaskOutcome>
}

export interface HeartbeatRunInput {
  readonly agent: AgentProfile
  readonly prompt: string
  readonly session: HeartbeatSessionMode
  readonly channel?: ChannelId
}

export interface HeartbeatDeps {
  readonly agents: AgentRegistry
  /** Agents switched off by the operator; a paused agent's heartbeat does not fire. */
  readonly pauses?: Pick<AgentPauseStore, 'list'>
  readonly runner: Runner
  readonly store: HeartbeatStore
  /** The task lease must outlast the run it protects, or recovery would steal live work. */
  readonly runMaxDurationMs: number
  readonly notifier: DeliverySink
  readonly logger: Logger
  readonly workspaceDir: (agent: AgentProfile) => string
  readonly runInput: (input: HeartbeatRunInput) => RunInput
  /** Tasks a module adds for this agent, read on every tick, beside its `HEARTBEAT.md`. A rejection
   *  skips the agent's tick. */
  readonly extraTasks?: (agent: AgentProfile) => Promise<readonly HeartbeatTask[]>
}
