import type { JobId } from '@/core/ids'
import type { Dialect, Storage } from '@/core/types/storage'
import { AppError, StorageError } from '@/core/errors'
import { toNanoUsd } from '@/persistence/money'

const STALE_MESSAGE = 'daemon restart'

type SchedulerRunOutcome =
  | {
      readonly status: 'success'
      readonly endedAtMs: number
      readonly summary: string
      readonly costUsd: number
      readonly deliveryError?: string
    }
  | { readonly status: 'failed'; readonly endedAtMs: number; readonly errorMessage: string }

type SchedulerOccurrenceClaim =
  | { readonly kind: 'claimed'; readonly runId: number; readonly token: string }
  | {
      readonly kind: 'already_claimed'
      readonly status: 'running' | 'success' | 'failed'
      readonly runId: number
      readonly leaseUntilMs: number | null
    }
  | { readonly kind: 'missing' }

type SchedulerJobTransition =
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
  start(jobId: JobId, startedAtMs: number): Promise<number | undefined>
  /** Closes a 'running' row by id with no job transition; stalled-run recovery depends on it. */
  finish(runId: number, outcome: SchedulerRunOutcome): Promise<void>
  markStale(nowMs: number): Promise<number>
  claim(options: {
    readonly jobId: JobId
    readonly scheduledFor: number
    readonly token: string
    readonly startedAtMs: number
    readonly leaseUntilMs: number
  }): Promise<SchedulerOccurrenceClaim>
  finalize(input: SchedulerOccurrenceFinalization): Promise<boolean>
  /** Best-effort: a lost lease (wrong token, or the row is no longer 'running') is a silent no-op. */
  renewLease(runId: number, token: string, leaseUntilMs: number): Promise<void>
  recordDeliveryError(runId: number, errorMessage: string): Promise<void>
  /** Throws on a replayed request: the (job_id, request_id) row proves the command already ran. */
  startRunNow(jobId: JobId, requestId: string, startedAtMs: number): Promise<number>
  finishRunNow(runId: number, outcome: SchedulerRunOutcome): Promise<void>
}

class SchedulerOccurrenceConflictError extends AppError {
  readonly code = 'occurrence_conflict' as const

  constructor() {
    super('scheduler occurrence conflict')
  }
}

export function createSchedulerOccurrenceStore(
  db: Storage,
  dialect: Dialect
): SchedulerOccurrenceStore {
  const sql = buildSql(dialect)

  return {
    start: (jobId, startedAtMs) => startRun({ db, sql, jobId, startedAtMs }),
    finish: (runId, outcome) => finishRun({ db, sql, runId, outcome }),
    markStale: (nowMs) => markStaleRuns({ db, sql, nowMs }),
    claim: (options) => claimOccurrence({ db, sql, ...options }),
    finalize: (input) => finalizeOccurrence({ db, sql, input }),
    renewLease: (runId, token, leaseUntilMs) => renewLease({ db, sql, runId, token, leaseUntilMs }),
    recordDeliveryError: (runId, errorMessage) =>
      recordDeliveryError({ db, sql, runId, errorMessage }),
    startRunNow: (jobId, requestId, startedAtMs) =>
      startRunNow({ db, sql, jobId, requestId, startedAtMs }),
    finishRunNow: (runId, outcome) => finishRun({ db, sql, runId, outcome }),
  }
}

interface StartRunOptions {
  readonly db: Storage
  readonly sql: ReturnType<typeof buildSql>
  readonly jobId: JobId
  readonly startedAtMs: number
}

async function startRun(options: StartRunOptions): Promise<number | undefined> {
  const rows = await options.db.query<{ readonly id: number }>(options.sql.start, [
    options.jobId,
    options.startedAtMs,
  ])
  return rows[0]?.id
}

interface StartRunNowOptions {
  readonly db: Storage
  readonly sql: ReturnType<typeof buildSql>
  readonly jobId: JobId
  readonly requestId: string
  readonly startedAtMs: number
}

async function startRunNow(options: StartRunNowOptions): Promise<number> {
  const { db, sql, jobId, requestId, startedAtMs } = options
  const rows = await db.query<{ readonly id: number }>(sql.startRunNow, [
    jobId,
    requestId,
    startedAtMs,
  ])
  const id = rows[0]?.id

  if (id === undefined) {
    throw new SchedulerOccurrenceConflictError()
  }

  return id
}

interface FinishRunOptions {
  readonly db: Storage
  readonly sql: ReturnType<typeof buildSql>
  readonly runId: number
  readonly outcome: SchedulerRunOutcome
}

async function finishRun(options: FinishRunOptions): Promise<void> {
  const { db, sql, runId, outcome } = options

  if (outcome.status === 'success') {
    await db.execute(sql.finishSuccess, [
      outcome.summary,
      toNanoUsd(outcome.costUsd),
      outcome.endedAtMs,
      outcome.deliveryError ?? null,
      runId,
    ])

    return
  }

  await db.execute(sql.finishFailed, [outcome.errorMessage, outcome.endedAtMs, runId])
}

interface MarkStaleOptions {
  readonly db: Storage
  readonly sql: ReturnType<typeof buildSql>
  readonly nowMs: number
}

// The started_at cutoff bounds the sweep to rows claimed before boot: the caller does not await
// it, so a run claimed after startup must never be flipped to failed under its live executor.
// A row whose lease is still live belongs to another daemon on a shared database.
async function markStaleRuns(options: MarkStaleOptions): Promise<number> {
  const { changes } = await options.db.execute(options.sql.markStale, [
    STALE_MESSAGE,
    options.nowMs,
    options.nowMs,
    options.nowMs,
  ])
  return changes
}

interface ClaimOccurrenceOptions {
  readonly db: Storage
  readonly sql: ReturnType<typeof buildSql>
  readonly jobId: JobId
  readonly scheduledFor: number
  readonly token: string
  readonly startedAtMs: number
  readonly leaseUntilMs: number
}

async function claimOccurrence(options: ClaimOccurrenceOptions): Promise<SchedulerOccurrenceClaim> {
  const { db, sql, jobId, scheduledFor, token, startedAtMs, leaseUntilMs } = options

  try {
    return await db.transaction(async (tx) => {
      const inserted = await tx.query<{ readonly id: number }>(sql.claim, [
        jobId,
        scheduledFor,
        token,
        startedAtMs,
        leaseUntilMs,
      ])
      const created = inserted[0]

      if (created !== undefined) {
        return { kind: 'claimed', runId: created.id, token }
      }

      const existing = await tx.query<{
        readonly id: number
        readonly status: 'running' | 'success' | 'failed'
        readonly lease_until: number | null
      }>(sql.findClaimed, [jobId, scheduledFor])
      const found = existing[0]

      return found === undefined
        ? { kind: 'missing' }
        : {
            kind: 'already_claimed',
            status: found.status,
            runId: found.id,
            leaseUntilMs: found.lease_until,
          }
    })
  } catch (err: unknown) {
    if (isForeignKeyViolation(err)) {
      return { kind: 'missing' }
    }

    throw err
  }
}

interface RenewLeaseOptions {
  readonly db: Storage
  readonly sql: ReturnType<typeof buildSql>
  readonly runId: number
  readonly token: string
  readonly leaseUntilMs: number
}

async function renewLease(options: RenewLeaseOptions): Promise<void> {
  const { db, sql, runId, token, leaseUntilMs } = options
  await db.execute(sql.renewLease, [leaseUntilMs, runId, token])
}

interface FinalizeOccurrenceOptions {
  readonly db: Storage
  readonly sql: ReturnType<typeof buildSql>
  readonly input: SchedulerOccurrenceFinalization
}

async function finalizeOccurrence(options: FinalizeOccurrenceOptions): Promise<boolean> {
  const { db, sql, input } = options

  try {
    await db.transaction(async (tx) => {
      const runUpdate = finalizeRunParams({
        sql,
        runId: input.runId,
        token: input.token,
        outcome: input.outcome,
      })
      const runResult = await tx.execute(runUpdate.sql, runUpdate.params)

      if (runResult.changes !== 1) {
        throw new SchedulerOccurrenceConflictError()
      }

      const jobUpdate = transitionParams(sql, input.jobId, input.transition)
      const jobResult = await tx.execute(jobUpdate.sql, jobUpdate.params)

      if (jobResult.changes !== 1) {
        throw new SchedulerOccurrenceConflictError()
      }
    })
  } catch (err: unknown) {
    if (err instanceof SchedulerOccurrenceConflictError) {
      return false
    }

    throw err
  }

  return true
}

interface RecordDeliveryErrorOptions {
  readonly db: Storage
  readonly sql: ReturnType<typeof buildSql>
  readonly runId: number
  readonly errorMessage: string
}

async function recordDeliveryError(options: RecordDeliveryErrorOptions): Promise<void> {
  const { db, sql, runId, errorMessage } = options
  await db.execute(sql.recordDeliveryError, [errorMessage, runId])
}

interface SqlAndParams {
  readonly sql: string
  readonly params: readonly unknown[]
}

interface FinalizeRunParamsOptions {
  readonly sql: ReturnType<typeof buildSql>
  readonly runId: number
  readonly token: string
  readonly outcome: SchedulerRunOutcome
}

function finalizeRunParams(options: FinalizeRunParamsOptions): SqlAndParams {
  const { sql, runId, token, outcome } = options

  if (outcome.status === 'success') {
    return {
      sql: sql.finalizeSuccess,
      params: [
        outcome.summary,
        toNanoUsd(outcome.costUsd),
        outcome.endedAtMs,
        outcome.deliveryError ?? null,
        runId,
        token,
      ],
    }
  }

  return {
    sql: sql.finalizeFailed,
    params: [outcome.errorMessage, outcome.endedAtMs, runId, token],
  }
}

function transitionParams(
  sql: ReturnType<typeof buildSql>,
  jobId: JobId,
  transition: SchedulerJobTransition
): SqlAndParams {
  if (transition.kind === 'advance') {
    return { sql: sql.transitionAdvance, params: [transition.nextRunAt, jobId] }
  }

  if (transition.kind === 'skip') {
    return { sql: sql.transitionSkip, params: [transition.nextRunAt, jobId] }
  }

  if (transition.kind === 'disable') {
    return { sql: sql.transitionDisable, params: [jobId] }
  }

  return { sql: sql.transitionRetry, params: [transition.failures, transition.nextRunAt, jobId] }
}

function isForeignKeyViolation(err: unknown): boolean {
  if (!(err instanceof StorageError)) {
    return false
  }

  const cause = err.cause

  if (cause === null || typeof cause !== 'object') {
    return false
  }
  if (!('code' in cause)) {
    return false
  }

  const code = cause.code
  return code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || code === '23503'
}

// Split the way the tables are: the occurrence row's own lifecycle, then the job it advances.
function buildSql(d: Dialect) {
  return { ...buildOccurrenceSql(d), ...buildTransitionSql(d) }
}

function buildOccurrenceSql(d: Dialect) {
  return {
    start:
      `INSERT INTO scheduler_runs (job_id, started_at, status) ` +
      `VALUES (${d.param(1)}, ${d.param(2)}, 'running') RETURNING id`,
    startRunNow:
      `INSERT INTO scheduler_runs (job_id, request_id, started_at, status) ` +
      `VALUES (${d.param(1)}, ${d.param(2)}, ${d.param(3)}, 'running') ` +
      `ON CONFLICT (job_id, request_id) DO NOTHING RETURNING id`,
    finishSuccess:
      `UPDATE scheduler_runs SET status = 'success', summary = ${d.param(1)}, ` +
      `cost_nano_usd = ${d.param(2)}, ended_at = ${d.param(3)}, ` +
      `error_message = ${d.param(4)} WHERE id = ${d.param(5)} AND status = 'running'`,
    finishFailed:
      `UPDATE scheduler_runs SET status = 'failed', error_message = ${d.param(1)}, ` +
      `ended_at = ${d.param(2)} WHERE id = ${d.param(3)} AND status = 'running'`,
    markStale:
      `UPDATE scheduler_runs SET status = 'failed', error_message = ${d.param(1)}, ` +
      `ended_at = ${d.param(2)} WHERE status = 'running' AND started_at < ${d.param(3)} ` +
      `AND (lease_until IS NULL OR lease_until < ${d.param(4)})`,
    claim:
      `INSERT INTO scheduler_runs (job_id, scheduled_for, claim_token, started_at, status, lease_until) ` +
      `VALUES (${d.param(1)}, ${d.param(2)}, ${d.param(3)}, ${d.param(4)}, 'running', ${d.param(5)}) ` +
      `ON CONFLICT (job_id, scheduled_for) DO NOTHING RETURNING id`,
    findClaimed:
      `SELECT id, status, lease_until FROM scheduler_runs ` +
      `WHERE job_id = ${d.param(1)} AND scheduled_for = ${d.param(2)}`,
    renewLease:
      `UPDATE scheduler_runs SET lease_until = ${d.param(1)} ` +
      `WHERE id = ${d.param(2)} AND claim_token = ${d.param(3)} AND status = 'running'`,
    finalizeSuccess:
      `UPDATE scheduler_runs SET status = 'success', summary = ${d.param(1)}, ` +
      `cost_nano_usd = ${d.param(2)}, ended_at = ${d.param(3)}, ` +
      `error_message = ${d.param(4)} ` +
      `WHERE id = ${d.param(5)} AND claim_token = ${d.param(6)} AND status = 'running'`,
    finalizeFailed:
      `UPDATE scheduler_runs SET status = 'failed', error_message = ${d.param(1)}, ` +
      `ended_at = ${d.param(2)} ` +
      `WHERE id = ${d.param(3)} AND claim_token = ${d.param(4)} AND status = 'running'`,
    recordDeliveryError:
      `UPDATE scheduler_runs SET error_message = ${d.param(1)} ` +
      `WHERE id = ${d.param(2)} AND status = 'success'`,
  }
}

function buildTransitionSql(d: Dialect) {
  return {
    transitionAdvance:
      `UPDATE jobs SET next_run_at = ${d.param(1)}, consecutive_failures = 0 ` +
      `WHERE id = ${d.param(2)}`,
    transitionSkip: `UPDATE jobs SET next_run_at = ${d.param(1)} WHERE id = ${d.param(2)}`,
    transitionDisable: `UPDATE jobs SET enabled = 0, consecutive_failures = 0 WHERE id = ${d.param(1)}`,
    transitionRetry:
      `UPDATE jobs SET consecutive_failures = ${d.param(1)}, next_run_at = ${d.param(2)} ` +
      `WHERE id = ${d.param(3)}`,
  }
}
