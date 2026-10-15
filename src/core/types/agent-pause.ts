import type { AgentId } from '@/core/ids'

/** Which of the operator's agents are switched off. A paused agent runs nothing it owns - a chat
 *  answer, a heartbeat, a job, a social visit - until it is resumed. Read per run, so a pause from
 *  the CLI reaches a running daemon without a restart. */
export interface AgentPauseStore {
  isPaused(id: AgentId): Promise<boolean>
  list(): Promise<ReadonlySet<AgentId>>
  /** Idempotent: pausing a paused agent keeps its first `at`. */
  pause(ids: readonly AgentId[], at: number): Promise<void>
  resume(ids: readonly AgentId[]): Promise<void>
}
