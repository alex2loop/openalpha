import type { Logger } from '@/core/logging/logger'
import type { Dialect, Storage, Transaction } from '@/core/types/storage'
import type { RetentionConfig } from '@/persistence/types'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_DAY } from '@/core/utils/time'
import { SESSION_ROUTE_KEY_PREFIX } from '@/persistence/stores/channel/chat-binding'
import { detachAttemptsSql } from '@/persistence/stores/session/sql'

const SCHEDULER_RUNS_KEEP_PER_JOB = 200
const BRIEF_SNAPSHOTS_KEEP_PER_LOCALE = 1
// Above the 366-day cost view range, so a full year of /v1/cost stays complete, and above any
// monthly cap window. Not the general window: `db prune --older-than` must not shorten the ledger.
const LLM_ATTEMPTS_RETENTION_MS = 400 * MS_PER_DAY
const ROUTE_KEY_PATTERN = `${SESSION_ROUTE_KEY_PREFIX}%`
const SQLITE_DIRECT_CHANGES_SQL = 'SELECT changes() AS n'

const EMPTY_COUNTS = Object.freeze({
  sessions: 0,
  sessionRoutes: 0,
  memory: 0,
  schedulerRuns: 0,
  inbox: 0,
  inboxAbandoned: 0,
  pairings: 0,
  alertsTerminal: 0,
  briefSnapshots: 0,
  llmAttempts: 0,
})

export interface RetentionCounts {
  readonly sessions: number
  readonly sessionRoutes: number
  readonly memory: number
  readonly schedulerRuns: number
  readonly inbox: number
  readonly inboxAbandoned: number
  readonly pairings: number
  readonly alertsTerminal: number
  readonly briefSnapshots: number
  readonly llmAttempts: number
}

interface RetentionOptions {
  readonly config: RetentionConfig
  readonly logger: Logger
}

interface RetentionCutoffs {
  readonly now: number
  readonly general: number
  readonly inbox: number
}

// One scope's delete, run in its own transaction: a slow or failing scope neither holds the
// single sqlite connection for the whole sweep nor rolls back the others.
interface RetentionScope {
  readonly name: keyof RetentionCounts
  run(tx: Transaction): Promise<number>
}

interface DeleteStatement {
  readonly sql: string
  readonly params: readonly unknown[]
}

export async function countRetention(
  db: Storage,
  dialect: Dialect,
  options: RetentionOptions
): Promise<RetentionCounts> {
  const times = cutoffs(options.config)

  return db.transaction(async (tx) => ({
    sessions: await countSessions(tx, dialect, times.general),
    sessionRoutes: await countSessionRoutes(tx, dialect, times.general),
    memory: await countMemory(tx, dialect, times),
    schedulerRuns: await countSchedulerRuns(tx, dialect, times.general),
    inbox: await countInbox(tx, dialect, times.inbox),
    inboxAbandoned: await countInboxAbandoned(tx, dialect, times.general),
    pairings: await countPairings(tx, dialect, times.general),
    alertsTerminal: await countAlertsTerminal(tx, dialect, times.general),
    briefSnapshots: await countBriefSnapshots(tx, dialect, times.general),
    llmAttempts: await countLlmAttempts(tx, dialect, times.now - LLM_ATTEMPTS_RETENTION_MS),
  }))
}

export async function runRetention(
  db: Storage,
  dialect: Dialect,
  options: RetentionOptions
): Promise<RetentionCounts> {
  const counts: Record<keyof RetentionCounts, number> = { ...EMPTY_COUNTS }

  for (const scope of toScopes(dialect, cutoffs(options.config))) {
    counts[scope.name] = await runScope(db, scope, options.logger)
  }

  options.logger.info('retention.pruned', counts)

  return counts
}

// Routes before sessions: the route delete selects through the sessions it is about to lose.
function toScopes(dialect: Dialect, times: RetentionCutoffs): readonly RetentionScope[] {
  const attempts = times.now - LLM_ATTEMPTS_RETENTION_MS

  return [
    { name: 'sessionRoutes', run: (tx) => deleteSessionRoutes(tx, dialect, times.general) },
    { name: 'sessions', run: (tx) => deleteSessions(tx, dialect, times.general) },
    { name: 'memory', run: (tx) => deleteMemory(tx, dialect, times) },
    { name: 'schedulerRuns', run: (tx) => deleteSchedulerRuns(tx, dialect, times.general) },
    { name: 'inbox', run: (tx) => deleteInbox(tx, dialect, times.inbox) },
    { name: 'inboxAbandoned', run: (tx) => deleteInboxAbandoned(tx, dialect, times.general) },
    { name: 'pairings', run: (tx) => deletePairings(tx, dialect, times.general) },
    { name: 'alertsTerminal', run: (tx) => deleteAlertsTerminal(tx, dialect, times.general) },
    { name: 'briefSnapshots', run: (tx) => deleteBriefSnapshots(tx, dialect, times.general) },
    { name: 'llmAttempts', run: (tx) => deleteLlmAttempts(tx, dialect, attempts) },
  ]
}

// A failed scope counts zero and the sweep goes on: the rows wait for the next sweep.
async function runScope(db: Storage, scope: RetentionScope, logger: Logger): Promise<number> {
  try {
    return await db.transaction((tx) => scope.run(tx))
  } catch (err: unknown) {
    logger.warn('retention.scope_failed', { scope: scope.name, err: formatErrForLog(err) })

    return 0
  }
}

function cutoffs(config: RetentionConfig): RetentionCutoffs {
  const now = Date.now()
  return {
    now,
    general: now - config.retentionDays * MS_PER_DAY,
    inbox: now - config.inboxRetentionDays * MS_PER_DAY,
  }
}

function sessionWhere(atParam: string): string {
  return `status <> 'active' AND COALESCE(ended_at, last_activity_at) < ${atParam}`
}

function sessionRouteWhere(dialect: Dialect): string {
  return (
    `key LIKE ${dialect.param(1)} AND value IN (` +
    `SELECT id FROM sessions WHERE ${sessionWhere(dialect.param(2))})`
  )
}

function inboxTerminalWhere(atParam: string): string {
  return `status IN ('completed', 'failed') AND completed_at IS NOT NULL AND completed_at < ${atParam}`
}

// Rows a removed channel left behind: no drain claims them, so they never reach the terminal status
// the inbox window needs. `started_at` is NULL until a claim and renewed while one is live, so this
// cutoff cannot match work a daemon still owns.
function inboxAbandonedWhere(atParam: string): string {
  return `status IN ('pending', 'processing') AND COALESCE(started_at, accepted_at) < ${atParam}`
}

// The alert CHECKs make fired_at/disabled_at present exactly when their state holds, so the
// COALESCE always lands on the instant the row became terminal. Live states never match.
function alertTerminalWhere(atParam: string): string {
  return `state IN ('fired','disabled') AND COALESCE(fired_at, disabled_at) < ${atParam}`
}

// Ranked over every row, not just expired ones: the newest brief per locale survives regardless of
// age, so a replay after a long pause still has a snapshot to show.
function briefCandidateSql(): string {
  return (
    `WITH ranked AS (` +
    `SELECT id, created_at, ` +
    `ROW_NUMBER() OVER (PARTITION BY authored_locale ORDER BY day DESC, id DESC) AS rn ` +
    `FROM brief_snapshots` +
    `) `
  )
}

function schedulerCandidateSql(_dialect: Dialect, atParam: string): string {
  return (
    `WITH ranked AS (` +
    `SELECT id, ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY started_at DESC, id DESC) AS rn ` +
    `FROM scheduler_runs WHERE started_at < ${atParam}` +
    `) `
  )
}

async function countSessions(tx: Transaction, dialect: Dialect, cutoff: number): Promise<number> {
  const at = dialect.param(1)

  return countRows(tx, `SELECT COUNT(*) AS n FROM sessions WHERE ${sessionWhere(at)}`, [cutoff])
}

async function countSessionRoutes(
  tx: Transaction,
  dialect: Dialect,
  cutoff: number
): Promise<number> {
  const sql = `SELECT COUNT(*) AS n FROM channel_state WHERE ${sessionRouteWhere(dialect)}`

  return countRows(tx, sql, [ROUTE_KEY_PATTERN, cutoff])
}

async function countMemory(
  tx: Transaction,
  dialect: Dialect,
  times: RetentionCutoffs
): Promise<number> {
  const sql = `SELECT COUNT(*) AS n FROM memory_kv WHERE ${memoryWhere(dialect)}`

  return countRows(tx, sql, [times.now, times.general])
}

async function countSchedulerRuns(
  tx: Transaction,
  dialect: Dialect,
  cutoff: number
): Promise<number> {
  const at = dialect.param(1)
  const sql = `${schedulerCandidateSql(dialect, at)}SELECT COUNT(*) AS n FROM ranked WHERE rn > ${dialect.param(2)}`

  return countRows(tx, sql, [cutoff, SCHEDULER_RUNS_KEEP_PER_JOB])
}

async function countInbox(tx: Transaction, dialect: Dialect, cutoff: number): Promise<number> {
  const sql = `SELECT COUNT(*) AS n FROM channel_inbox WHERE ${inboxTerminalWhere(dialect.param(1))}`

  return countRows(tx, sql, [cutoff])
}

async function countInboxAbandoned(
  tx: Transaction,
  dialect: Dialect,
  cutoff: number
): Promise<number> {
  const sql = `SELECT COUNT(*) AS n FROM channel_inbox WHERE ${inboxAbandonedWhere(dialect.param(1))}`

  return countRows(tx, sql, [cutoff])
}

async function countPairings(tx: Transaction, dialect: Dialect, cutoff: number): Promise<number> {
  const at = dialect.param(1)
  const sql = `SELECT COUNT(*) AS n FROM pairings WHERE status = 'pending' AND created_at < ${at}`

  return countRows(tx, sql, [cutoff])
}

async function countAlertsTerminal(
  tx: Transaction,
  dialect: Dialect,
  cutoff: number
): Promise<number> {
  const sql = `SELECT COUNT(*) AS n FROM alerts WHERE ${alertTerminalWhere(dialect.param(1))}`

  return countRows(tx, sql, [cutoff])
}

async function countBriefSnapshots(
  tx: Transaction,
  dialect: Dialect,
  cutoff: number
): Promise<number> {
  const sql =
    `${briefCandidateSql()}SELECT COUNT(*) AS n FROM ranked ` +
    `WHERE rn > ${dialect.param(1)} AND created_at < ${dialect.param(2)}`

  return countRows(tx, sql, [BRIEF_SNAPSHOTS_KEEP_PER_LOCALE, cutoff])
}

async function countLlmAttempts(
  tx: Transaction,
  dialect: Dialect,
  cutoff: number
): Promise<number> {
  const sql = `SELECT COUNT(*) AS n FROM llm_attempts WHERE settled_at < ${dialect.param(1)}`

  return countRows(tx, sql, [cutoff])
}

async function deleteSessions(tx: Transaction, dialect: Dialect, cutoff: number): Promise<number> {
  const at = dialect.param(1)

  // Same steps and order as SessionStore.remove: llm_attempts has no FK, so a session's attempts
  // are detached explicitly rather than left pointing at a session that no longer exists.
  await tx.execute(
    `DELETE FROM session_messages WHERE session_id IN (SELECT id FROM sessions WHERE ${sessionWhere(at)})`,
    [cutoff]
  )
  await tx.execute(
    detachAttemptsSql(`session_id IN (SELECT id FROM sessions WHERE ${sessionWhere(at)})`),
    [cutoff]
  )

  return deleteCount(tx, dialect, {
    sql: `DELETE FROM sessions WHERE ${sessionWhere(at)}`,
    params: [cutoff],
  })
}

async function deleteSessionRoutes(
  tx: Transaction,
  dialect: Dialect,
  cutoff: number
): Promise<number> {
  return deleteCount(tx, dialect, {
    sql: `DELETE FROM channel_state WHERE ${sessionRouteWhere(dialect)}`,
    params: [ROUTE_KEY_PATTERN, cutoff],
  })
}

async function deleteMemory(
  tx: Transaction,
  dialect: Dialect,
  times: RetentionCutoffs
): Promise<number> {
  return deleteCount(tx, dialect, {
    sql: `DELETE FROM memory_kv WHERE ${memoryWhere(dialect)}`,
    params: [times.now, times.general],
  })
}

async function deleteSchedulerRuns(
  tx: Transaction,
  dialect: Dialect,
  cutoff: number
): Promise<number> {
  const at = dialect.param(1)

  return deleteCount(tx, dialect, {
    sql:
      `${schedulerCandidateSql(dialect, at)}DELETE FROM scheduler_runs WHERE id IN (` +
      `SELECT id FROM ranked WHERE rn > ${dialect.param(2)})`,
    params: [cutoff, SCHEDULER_RUNS_KEEP_PER_JOB],
  })
}

async function deleteInbox(tx: Transaction, dialect: Dialect, cutoff: number): Promise<number> {
  return deleteCount(tx, dialect, {
    sql: `DELETE FROM channel_inbox WHERE ${inboxTerminalWhere(dialect.param(1))}`,
    params: [cutoff],
  })
}

async function deleteInboxAbandoned(
  tx: Transaction,
  dialect: Dialect,
  cutoff: number
): Promise<number> {
  return deleteCount(tx, dialect, {
    sql: `DELETE FROM channel_inbox WHERE ${inboxAbandonedWhere(dialect.param(1))}`,
    params: [cutoff],
  })
}

async function deletePairings(tx: Transaction, dialect: Dialect, cutoff: number): Promise<number> {
  const at = dialect.param(1)

  return deleteCount(tx, dialect, {
    sql: `DELETE FROM pairings WHERE status = 'pending' AND created_at < ${at}`,
    params: [cutoff],
  })
}

async function deleteAlertsTerminal(
  tx: Transaction,
  dialect: Dialect,
  cutoff: number
): Promise<number> {
  return deleteCount(tx, dialect, {
    sql: `DELETE FROM alerts WHERE ${alertTerminalWhere(dialect.param(1))}`,
    params: [cutoff],
  })
}

async function deleteBriefSnapshots(
  tx: Transaction,
  dialect: Dialect,
  cutoff: number
): Promise<number> {
  return deleteCount(tx, dialect, {
    sql:
      `${briefCandidateSql()}DELETE FROM brief_snapshots WHERE id IN (` +
      `SELECT id FROM ranked WHERE rn > ${dialect.param(1)} AND created_at < ${dialect.param(2)})`,
    params: [BRIEF_SNAPSHOTS_KEEP_PER_LOCALE, cutoff],
  })
}

async function deleteLlmAttempts(
  tx: Transaction,
  dialect: Dialect,
  cutoff: number
): Promise<number> {
  return deleteCount(tx, dialect, {
    sql: `DELETE FROM llm_attempts WHERE settled_at < ${dialect.param(1)}`,
    params: [cutoff],
  })
}

function memoryWhere(dialect: Dialect): string {
  return (
    `(expires_at IS NOT NULL AND expires_at < ${dialect.param(1)}) OR ` +
    `(deleted_at IS NOT NULL AND deleted_at < ${dialect.param(2)})`
  )
}

async function deleteCount(
  tx: Transaction,
  dialect: Dialect,
  statement: DeleteStatement
): Promise<number> {
  const result = await tx.execute(statement.sql, statement.params)

  if (dialect.name === 'postgres') {
    return result.changes
  }

  // Bun includes trigger and foreign-key side effects; changes() reports only the direct rows.
  return countRows(tx, SQLITE_DIRECT_CHANGES_SQL)
}

async function countRows(
  tx: Transaction,
  sql: string,
  params?: readonly unknown[]
): Promise<number> {
  const rows = await tx.query<{ readonly n: number }>(sql, params)
  return rows[0]?.n ?? 0
}
