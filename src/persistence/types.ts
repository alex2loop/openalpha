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
  ModelRunCost,
  RootRunCostRow,
  RunCalls,
  SpendBreakdownRow,
} from '@/core/types/usage'
import type { EpochRange } from '@/core/utils/time'

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
  /** Absent on a row a slash command contributed outside a run. */
  readonly runId?: RunId
  readonly message: LLMMessage
  readonly createdAt: number
}

/** One row of the display transcript and the run that wrote it, when one did. */
export interface TranscriptMessage {
  readonly message: LLMMessage
  readonly runId?: RunId
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

export interface HistoryPageQuery {
  /** Transcript index (`idx`): only rows strictly older than it. Newest rows when absent. */
  readonly before?: number
  /** Only the assistant rows this run wrote, the newest `limit` of them; `before` is not read. */
  readonly runId?: RunId
  readonly limit: number
}

export interface HistoryPage {
  /** User and assistant rows only, a slash command's display-only rows included, oldest first. */
  readonly messages: readonly TranscriptMessage[]
  readonly hasMore: boolean
  /** `idx` of the oldest returned row, the next page's `before`; null when nothing older remains. */
  readonly nextBefore: number | null
}

export interface SessionListQuery {
  /** Only sessions of these channels; every channel when absent, none when empty. */
  readonly channels?: readonly ChannelId[]
  /** Text any message of the session contains, ignoring case. */
  readonly query?: string
  /** `lastActivityAt`: only sessions strictly older than it. The newest when absent. */
  readonly before?: number
  /** With `before`, pages by `(lastActivityAt, id)`: sessions sharing `before` come after this id,
   *  so none is skipped at a page edge. */
  readonly beforeId?: SessionId
  /** Only this one session, empty or not; every other listing leaves out a session with no
   *  user or assistant row. */
  readonly id?: SessionId
  readonly limit: number
}

/** One session as a list shows it. The two contents are stored text, a JSON string or a block
 *  array, left for the caller to read. */
export interface SessionListing {
  readonly id: SessionId
  readonly agentId: AgentId
  readonly channel: ChannelId
  readonly chatId?: string
  readonly startedAt: number
  readonly lastActivityAt: number
  /** User and assistant rows, as the history page counts them. */
  readonly messageCount: number
  readonly firstUserContent: string | null
  readonly lastAssistantContent: string | null
}

export interface SessionStore extends SessionActivity {
  create(record: OpenedSession): Promise<void>
  /** Take ownership of the session for one run. False when a live run already holds it. */
  claimRun(claim: SessionClaim): Promise<boolean>
  /** Ordered transcript payloads for a resumed run, display-only rows left out. With `limit`, only
   *  the newest that many rows, still in order; the whole transcript otherwise. */
  loadHistory(id: SessionId, limit?: number): Promise<readonly LLMMessage[]>
  /** One page of the display transcript (user/assistant rows), cut in SQL. */
  loadHistoryPage(id: SessionId, query: HistoryPageQuery): Promise<HistoryPage>
  /** The operator detail read: lifecycle, stored-message metadata, linked attempts, totals. */
  loadDetails(id: SessionId): Promise<SessionSnapshot | null>
  /** Resolve a displayed session-id prefix without loading unbounded history. */
  resolveIdPrefix(prefix: string): Promise<SessionIdResolution>
  listRecent(limit: number): Promise<readonly SessionSummary[]>
  /** Sessions newest activity first, across the named channels, cut in SQL. */
  listByChannels(query: SessionListQuery): Promise<readonly SessionListing[]>
  latestIdForChannel(channel: ChannelId): Promise<SessionId | null>
  /** The channel the session belongs to; absent for an unknown id. */
  channelOf(id: SessionId): Promise<string | undefined>
  /** Cumulative totals folded from the session's durable attempts; zeros when it has none. */
  loadTotals(id: SessionId): Promise<LLMUsageTotals>
  /** Append-only write of the messages a run produced since its last flush (engine's SessionSink). */
  appendMessages(id: SessionId, writes: readonly SessionMessageWrite[]): Promise<void>
  /** The two rows a slash command contributes: they name the command's run, when it ran as one,
   *  and no attempt is linked to them. */
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
  /** The same attempts `totalRange` sums, by top-level run and job, costliest first. */
  rootRunsForRange(range: CostRange): Promise<readonly RootRunCostRow[]>
  /** What one billing agent has spent today, on the operator's calendar. Counts every run an
   *  agent started: its own, its delegates', and the debates it asked for. */
  totalForBillingAgent(agentId: AgentId, nowMs: number): Promise<number>
  /** Today's spend of every billing agent that has any, in one read. An agent absent from the map
   *  has spent nothing. */
  totalsForBillingAgents(nowMs: number): Promise<ReadonlyMap<AgentId, number>>
  /** The mean cost of one run on each named model over its last `sample` runs inside the recent
   *  window, a run being the attempts that share a `run_id`. A model with no attempts there is
   *  absent. */
  perRunCostByModel(
    models: readonly string[],
    sample: number,
    nowMs: number
  ): Promise<readonly ModelRunCost[]>
  /** The attempts of one run and everything beneath it, as `/v1/activity` prices a run, newest
   *  first, at most `limit`; the totals cover them all. A run with none, or an unknown one,
   *  answers an empty list. */
  attemptsForRun(runId: RunId, limit: number): Promise<RunCalls>
  /** Which of these attempts are already durable — a write whose acknowledgement was lost is. */
  recordedIds(ids: readonly LLMAttemptId[]): Promise<ReadonlySet<LLMAttemptId>>
}

/** One finished run, as the activity page lists it. A child run names its parent; a command has no
 *  agent. */
export interface RunLogRow {
  readonly runId: RunId
  readonly kind: 'agent' | 'command'
  /** The agent id, or the command name. */
  readonly name: string
  readonly title?: string
  readonly summary?: string
  readonly agentId?: AgentId
  readonly channel?: ChannelId
  readonly chatId?: string
  readonly sessionId?: SessionId
  readonly parentRunId?: RunId
  /** The admitted sources a research run ended with. */
  readonly sources?: number
  /** The tickers the run reported on, in the order first seen. */
  readonly tickers?: readonly string[]
  /** The research questions the run answered, of how many it asked. */
  readonly questionsDone?: number
  readonly questionsTotal?: number
  readonly startedAt: number
  readonly endedAt: number
  /** A run result reason for an agent, `completed | aborted | error` for a command. */
  readonly outcome: string
}

export interface CommandCostRange {
  readonly lowUsd: number
  readonly highUsd: number
  /** Finished runs in the sample, free ones included. */
  readonly runs: number
}

export interface RunLogStore {
  /** A run is written once; recording the same id again keeps the first row. */
  record(row: RunLogRow): Promise<void>
  /** Runs that ended in `[fromMs, toMs)` and have no parent, newest first. */
  listTopLevel(fromMs: number, toMs: number, limit: number): Promise<readonly RunLogRow[]>
  /** Each run's direct children, oldest first, at most `perRun` of each. A run with none is absent. */
  childrenOf(
    runIds: readonly RunId[],
    perRun: number
  ): Promise<ReadonlyMap<RunId, readonly RunLogRow[]>>
  /** Top-level runs of one agent that ended before `beforeMs`, newest first. */
  listResearch(agent: string, beforeMs: number, limit: number): Promise<readonly RunLogRow[]>
  /** How many top-level runs of one agent ended in `[fromMs, toMs)`. */
  countResearch(agent: string, fromMs: number, toMs: number): Promise<number>
  /** What each run and every run beneath it cost, in USD. A run with no attempts is absent. */
  costOf(runIds: readonly RunId[]): Promise<ReadonlyMap<RunId, number>>
  /** The 25th to 75th percentile of what each name's last `sample` finished command runs cost,
   *  over the runs that cost something (0 to 0 when none did). A name with no run is absent. */
  costRangeByName(
    names: readonly string[],
    sample: number
  ): Promise<ReadonlyMap<string, CommandCostRange>>
}

/** One notice the bell holds. `event` is the wire event as JSON, exactly what a socket was sent;
 *  `deliveredTo` lists the channels that also got it (empty for the bell alone). */
export interface NoticeRow {
  readonly id: string
  readonly kind: string
  readonly weight: string
  readonly wake: boolean
  readonly runId?: string
  readonly deliveredTo: readonly string[]
  readonly event: string
  readonly createdAt: number
  readonly readAt?: number
}

/** Where a page of notices resumes: strictly older than `createdAt`, and with `id` also the notices of
 *  that same instant that sort after it. */
export interface NoticeCursor {
  readonly createdAt: number
  readonly id?: string
}

export interface NoticeStore {
  record(row: NoticeRow): Promise<void>
  /** Notices after the cursor (from the newest when absent), newest first. */
  list(cursor: NoticeCursor | undefined, limit: number): Promise<readonly NoticeRow[]>
  /** Notices of one kind created in the range, oldest first. */
  listOfKind(kind: string, range: EpochRange, limit: number): Promise<readonly NoticeRow[]>
  /** Notices not yet read. */
  unreadCount(): Promise<number>
  /** Unread notices of one kind. */
  unreadCountOfKind(kind: string): Promise<number>
  /** Marks the named notices read (every unread one when `ids` is absent); an already read notice
   *  keeps its first read time. */
  markRead(ids: readonly string[] | undefined, at: number): Promise<void>
}

/** One signed-in browser. `id` is public (what the page lists and ends by); `secretHash` is the
 *  cookie secret's HMAC keyed by the API token, so the secret itself is never stored. */
export interface BrowserSessionRow {
  readonly id: string
  readonly secretHash: string
  /** Short browser label, may be ''. */
  readonly label: string
  readonly createdAt: number
  readonly lastSeenAt: number
}

export interface BrowserSessionStore {
  /** In one transaction: drops rows idle since before `keep.idleCutoff`, inserts, keeps the newest `keep.limit`. */
  insert(
    row: BrowserSessionRow,
    keep: { readonly idleCutoff: number; readonly limit: number }
  ): Promise<void>
  findBySecret(secretHash: string, idleCutoff: number): Promise<BrowserSessionRow | undefined>
  has(id: string): Promise<boolean>
  touch(id: string, at: number): Promise<void>
  /** Newest `last_seen_at` first. */
  list(idleCutoff: number, limit: number): Promise<readonly BrowserSessionRow[]>
  remove(id: string): Promise<boolean>
  removeAll(): Promise<number>
}

export interface RetentionConfig {
  readonly retentionDays: number
  /** Track-record and calibration rows; never shorter than `retentionDays`. */
  readonly historyRetentionDays: number
  readonly inboxRetentionDays: number
  /** How far back each history scope's readers look; a scope keeps at least that much whatever
   *  `historyRetentionDays` says. */
  readonly historyFloors: HistoryFloorDays
}

export interface HistoryFloorDays {
  /** The track record and factor attribution: suggestions, factor_log, theme_outcomes. */
  readonly trackRecord: number
  /** The macro year-over-year read: series_points, series_provenance. */
  readonly macroSeries: number
  /** The macro extract's backfill: macro_documents. */
  readonly macroDocuments: number
}
