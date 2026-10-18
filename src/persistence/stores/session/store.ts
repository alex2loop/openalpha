import type { ChannelId } from '@/core/channels'
import type { AgentId, RunId, SessionId } from '@/core/ids'
import type { OpenedSession } from '@/core/types/session'
import type { Dialect, Storage } from '@/core/types/storage'
import type { LLMUsageTotals } from '@/core/types/usage'
import type {
  SessionClaim,
  SessionClearResult,
  SessionIdResolution,
  SessionOutcome,
  SessionRemoval,
  SessionStatus,
  SessionStore,
  SessionSummary,
} from '@/persistence/types'
import { ConflictError, ValidationError } from '@/core/errors'
import { sessionId } from '@/core/ids'
import { toLikePrefixPattern } from '@/persistence/sql/like-escape'
import { SESSION_ROUTE_KEY_PREFIX } from '@/persistence/stores/channel/chat-binding'
import {
  type SessionSummaryRow,
  type TotalsRow,
  toSessionSummary,
  toTotals,
} from '@/persistence/stores/session/mapping'
import {
  appendCommandExchange,
  appendSessionMessages,
  loadSessionDetails,
  loadSessionHistory,
  type StoreDeps,
} from '@/persistence/stores/session/messages'
import { buildSessionSql } from '@/persistence/stores/session/sql'

const ROUTE_KEY_PATTERN = `${SESSION_ROUTE_KEY_PREFIX}%`
const MAX_PREFIX_MATCHES = 2

export function createSessionStore(db: Storage, dialect: Dialect): SessionStore {
  const store: StoreDeps = { db, sql: buildSessionSql(dialect) }
  const { sql } = store

  return {
    async create(record: OpenedSession): Promise<void> {
      const now = Date.now()

      await db.execute(sql.create, [
        record.id,
        record.agentId,
        record.userId,
        record.channel,
        record.chatId ?? null,
        now,
        now,
      ])
    },

    claimRun: (claim) => claimRun(store, claim),

    loadHistory: (id, limit) => loadSessionHistory(store, id, limit),
    loadDetails: (id) => loadSessionDetails(store, id),
    resolveIdPrefix: (prefix) => resolveIdPrefix(store, prefix),

    async listRecent(limit: number): Promise<readonly SessionSummary[]> {
      assertPositiveSafeInteger(limit, 'session history limit')
      const rows = await db.query<SessionSummaryRow>(sql.listRecent, [limit])
      return rows.map(toSessionSummary)
    },

    async latestIdForChannel(channel: ChannelId): Promise<SessionId | null> {
      const rows = await db.query<{ readonly id: string }>(sql.latestIdForChannel, [channel])
      const row = rows[0]
      return row === undefined ? null : sessionId(row.id)
    },

    async loadTotals(id: SessionId): Promise<LLMUsageTotals> {
      const rows = await db.query<TotalsRow>(sql.loadTotals, [id])
      return toTotals(rows[0])
    },

    appendMessages: (id, writes) => appendSessionMessages(store, id, writes),
    appendCommandExchange: (id, exchange) => appendCommandExchange(store, id, exchange),
    finalizeRun: (id, runId, outcome) => finalizeRun({ store, id, runId, outcome }),

    async updateStatus(id: SessionId, status: SessionStatus): Promise<void> {
      const now = Date.now()
      await db.execute(sql.updateStatus, [status, status === 'active' ? null : now, now, id])
    },

    remove: (id) => removeSession(store, id),
    count: (agent) => countSessions(store, agent),
    clear: (agent) => clearSessions(store, agent),

    async markStaleRuns(leaseExpiresBefore: number): Promise<number> {
      const { changes } = await db.execute(sql.markStale, [Date.now(), leaseExpiresBefore])
      return changes
    },
  }
}

async function countSessions(store: StoreDeps, agentId?: AgentId): Promise<number> {
  const sql = agentId === undefined ? store.sql.countAll : store.sql.countByAgent
  const rows = await store.db.query<{ readonly n: number }>(
    sql,
    agentId === undefined ? [] : [agentId]
  )

  return rows[0]?.n ?? 0
}

async function clearSessions(store: StoreDeps, agentId?: AgentId): Promise<SessionClearResult> {
  return await store.db.transaction(async (tx) => {
    const params = agentId === undefined ? [] : [agentId]
    const runningSql =
      agentId === undefined ? store.sql.countRunningAll : store.sql.countRunningByAgent
    const runningRows = await tx.query<{ readonly n: number }>(runningSql, params)
    const running = runningRows[0]?.n ?? 0

    if (running > 0) {
      return { kind: 'active', count: running }
    }

    const countSql = agentId === undefined ? store.sql.countAll : store.sql.countByAgent
    const countRows = await tx.query<{ readonly n: number }>(countSql, params)
    const count = countRows[0]?.n ?? 0

    if (agentId === undefined) {
      await tx.execute(store.sql.clearRoutesAll, [ROUTE_KEY_PATTERN])
      await tx.execute(store.sql.clearMessagesAll)
      await tx.execute(store.sql.detachAttemptsAll)
      await tx.execute(store.sql.clearAll)
    } else {
      await tx.execute(store.sql.clearRoutesByAgent, [ROUTE_KEY_PATTERN, agentId])
      await tx.execute(store.sql.clearMessagesByAgent, [agentId])
      await tx.execute(store.sql.detachAttemptsByAgent, [agentId])
      await tx.execute(store.sql.clearByAgent, [agentId])
    }

    return { kind: 'removed', count }
  })
}

async function resolveIdPrefix(store: StoreDeps, prefix: string): Promise<SessionIdResolution> {
  const rows = await store.db.query<{ readonly id: string }>(store.sql.resolveIdPrefix, [
    toLikePrefixPattern(prefix),
    prefix,
    MAX_PREFIX_MATCHES,
  ])

  if (rows.length === 0) {
    return { kind: 'not_found' }
  }

  const row = rows[0]

  if (row === undefined) {
    return { kind: 'not_found' }
  }

  if (row.id === prefix) {
    return { kind: 'found', id: sessionId(row.id) }
  }

  if (rows.length > 1) {
    return { kind: 'ambiguous' }
  }

  return { kind: 'found', id: sessionId(row.id) }
}

// The row is inserted only if absent so a first-time session has something to claim, then the
// claim itself is one UPDATE: two racing claimants both run it and the loser matches zero rows.
async function claimRun(store: StoreDeps, claim: SessionClaim): Promise<boolean> {
  const { session } = claim

  return await store.db.transaction(async (tx) => {
    await tx.execute(store.sql.insertIfAbsent, [
      session.id,
      session.agentId,
      session.userId,
      session.channel,
      session.chatId ?? null,
      claim.now,
      claim.now,
    ])

    const { changes } = await tx.execute(store.sql.claim, [
      claim.runId,
      claim.now,
      session.id,
      claim.leaseExpiresBefore,
    ])

    return changes === 1
  })
}

interface FinalizeRunInput {
  readonly store: StoreDeps
  readonly id: SessionId
  readonly runId: RunId
  readonly outcome: SessionOutcome
}

async function finalizeRun(input: FinalizeRunInput): Promise<void> {
  const { store, id, runId, outcome } = input
  const now = Date.now()
  const { changes } = await store.db.execute(store.sql.finalize, [
    outcome.reason,
    outcome.errorMessage ?? null,
    now,
    now,
    id,
    runId,
  ])

  if (changes !== 1) {
    throw new ConflictError(`session ${id} is not held by run ${runId}`)
  }
}

interface RunRow {
  readonly active_run_id: string | null
}

// The run is read inside the transaction: a running session's next message flush would fail on the
// cascaded delete, leaving its run unfinalized. A session open with no run holds nothing to lose.
async function removeSession(store: StoreDeps, id: SessionId): Promise<SessionRemoval> {
  return await store.db.transaction(async (tx) => {
    const rows = await tx.query<RunRow>(store.sql.selectRun, [id])
    const row = rows[0]

    if (row === undefined) {
      return 'not_found'
    }

    if (row.active_run_id !== null) {
      return 'active'
    }

    await tx.execute(store.sql.removeRoutes, [ROUTE_KEY_PATTERN, id])
    await tx.execute(store.sql.removeMessages, [id])
    await tx.execute(store.sql.detachAttempts, [id])
    await tx.execute(store.sql.remove, [id])

    return 'removed'
  })
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError(`${label} must be a positive safe integer`)
  }
}
