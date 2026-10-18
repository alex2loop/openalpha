import type { ChannelId } from '@/core/channels'
import type { AgentId, LLMAttemptId, RunId, SessionId, UserId } from '@/core/ids'
import type { LLMMessage, SessionMessageWrite } from '@/core/llm'
import type { CommandExchange } from '@/core/types/command'
import type { RunResultReason } from '@/core/types/run'
import type { OpenedSession, SessionActivity } from '@/core/types/session'
import type { Dialect, Transaction } from '@/core/types/storage'
import type {
  CostRange,
  DaySpend,
  LLMAttemptInput,
  LLMUsageTotals,
  SpendBreakdownRow,
} from '@/core/types/usage'

export type MigrationUp = (tx: Transaction, dialect: Dialect) => Promise<void>
export type MigrationDown = MigrationUp

// File name = migration id = `YYYY_MM_DD_HHMMSS_description`, so lexicographic sort is application
// order. A schema file always exports `up` and may export `down`; generation pairs those capabilities
// with the id read from its filename, so the two cannot drift.
export type Migration =
  | {
      readonly id: string
      readonly reversibility: 'reversible'
      readonly up: MigrationUp
      readonly down: MigrationDown
    }
  | {
      readonly id: string
      readonly reversibility: 'irreversible'
      readonly up: MigrationUp
    }

export interface SessionDetails {
  readonly id: SessionId
  readonly agentId: AgentId
  readonly userId: UserId
  readonly channel: ChannelId
  readonly chatId?: string
  readonly status: SessionStatus
  readonly endReason?: string
  readonly errorMessage?: string
  readonly startedAt: number
  readonly lastActivityAt: number
  readonly endedAt?: number
}

export interface StoredSessionMessage {
  readonly idx: number
  /** Absent on a row a slash command contributed: no run produced it. */
  readonly runId?: RunId
  readonly message: LLMMessage
  readonly createdAt: number
}

// A stored LLM-usage fact: history deletion detaches the session (null) instead of deleting
// the row, and a turn attempt may carry the assistant message it produced.
export type LLMAttempt = Omit<LLMAttemptInput, 'sessionId'> & {
  readonly sessionId: SessionId | null
  readonly messageIdx: number | null
}

export interface SessionSnapshot {
  readonly session: SessionDetails
  readonly messages: readonly StoredSessionMessage[]
  readonly attempts: readonly LLMAttempt[]
  readonly totals: LLMUsageTotals
}

export interface SessionSummary {
  readonly id: SessionId
  readonly agentId: AgentId
  readonly channel: ChannelId
  readonly status: SessionStatus
  readonly costUsd: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly modelCalls: number
  readonly lastActivityAt: number
}

export type SessionIdResolution =
  | { readonly kind: 'found'; readonly id: SessionId }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'ambiguous' }

export type SessionStatus = 'active' | 'done' | 'stale'

export type SessionRemoval = 'removed' | 'active' | 'not_found'

export type SessionClearResult =
  | { readonly kind: 'removed'; readonly count: number }
  | { readonly kind: 'active'; readonly count: number }

export interface SessionOutcome {
  readonly reason: RunResultReason
  readonly errorMessage?: string
}

export interface SessionClaim {
  readonly session: OpenedSession
  readonly runId: RunId
  /** One clock read for the whole claim: the row's activity stamp and the lease bound agree. */
  readonly now: number
  /** A holder whose last activity is older than this has lost its lease. */
  readonly leaseExpiresBefore: number
}

export interface SessionStore extends SessionActivity {
  create(record: OpenedSession): Promise<void>
  /** Take ownership of the session for one run. False when a live run already holds it. */
  claimRun(claim: SessionClaim): Promise<boolean>
  /** Ordered transcript payloads for a resumed run. With `limit`, only the newest that many rows,
   *  still in order; the whole transcript otherwise. */
  loadHistory(id: SessionId, limit?: number): Promise<readonly LLMMessage[]>
  /** The operator detail read: lifecycle, stored-message metadata, linked attempts, totals. */
  loadDetails(id: SessionId): Promise<SessionSnapshot | null>
  /** Resolve a displayed session-id prefix without loading unbounded history. */
  resolveIdPrefix(prefix: string): Promise<SessionIdResolution>
  listRecent(limit: number): Promise<readonly SessionSummary[]>
  latestIdForChannel(channel: ChannelId): Promise<SessionId | null>
  /** Cumulative totals folded from the session's durable attempts; zeros when it has none. */
  loadTotals(id: SessionId): Promise<LLMUsageTotals>
  /** Append-only write of the messages a run produced since its last flush (engine's SessionSink). */
  appendMessages(id: SessionId, writes: readonly SessionMessageWrite[]): Promise<void>
  /** The two rows a slash command contributes: no run owns them, so none is named or linked. */
  appendCommandExchange(id: SessionId, exchange: CommandExchange): Promise<void>
  /** Close the session out with its outcome. Only the holding run may; the other half of SessionSink. */
  finalizeRun(id: SessionId, runId: RunId, outcome: SessionOutcome): Promise<void>
  updateStatus(id: SessionId, status: SessionStatus): Promise<void>
  /**
   * Hard delete: route rows go first, then the session. Messages cascade; llm_attempts keep
   * their facts with session_id nulled. An `active` session is refused, not deleted.
   */
  remove(id: SessionId): Promise<SessionRemoval>
  count(agentId?: AgentId): Promise<number>
  clear(agentId?: AgentId): Promise<SessionClearResult>
  /** Boot-time only (daemon): every `active` session nobody holds a live lease on is orphaned. */
  markStaleRuns(leaseExpiresBefore: number): Promise<number>
}

export interface LLMAttemptStore {
  record(attempt: LLMAttemptInput): Promise<void>
  totalFor(period: 'day' | 'month', nowMs: number): Promise<number>
  totalRange(range: CostRange): Promise<number>
  /** Per calendar day, oldest first, zero days included. */
  dailyRange(range: CostRange): Promise<readonly DaySpend[]>
  breakdownFor(period: 'day' | 'month', nowMs: number): Promise<readonly SpendBreakdownRow[]>
  breakdownRange(range: CostRange): Promise<readonly SpendBreakdownRow[]>
  /** What one billing agent has spent today, on the operator's calendar. Counts every run an
   *  agent started: its own, its delegates', and the debates it asked for. */
  totalForBillingAgent(agentId: AgentId, nowMs: number): Promise<number>
  /** Today's spend of every billing agent that has any, in one read. An agent absent from the map
   *  has spent nothing. */
  totalsForBillingAgents(nowMs: number): Promise<ReadonlyMap<AgentId, number>>
  /** Which of these attempts are already durable — a write whose acknowledgement was lost is. */
  recordedIds(ids: readonly LLMAttemptId[]): Promise<ReadonlySet<LLMAttemptId>>
}

export interface RetentionConfig {
  readonly retentionDays: number
  readonly inboxRetentionDays: number
}
