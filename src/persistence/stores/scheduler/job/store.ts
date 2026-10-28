import type { JobId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { Dialect, Storage } from '@/core/types/storage'
import type { StoredEventFire, StoredEventMatch } from '@/persistence/stores/scheduler/job/event'
import type {
  JobRow,
  StoredJob,
  StoredJobEdit,
  StoredJobOwner,
  StoredJobStore,
} from '@/persistence/stores/scheduler/job/mapping'
import type { JobSql } from '@/persistence/stores/scheduler/job/sql'
import { formatErrForLog } from '@/core/security/credentials'
import { toLikePrefixPattern } from '@/persistence/sql/like-escape'
import { toTriggerParams } from '@/persistence/stores/scheduler/job/event'
import {
  ownerParams,
  toJob,
  toJobParams,
  toScheduleParams,
} from '@/persistence/stores/scheduler/job/mapping'
import { buildJobSql } from '@/persistence/stores/scheduler/job/sql'

const ENABLED = 1

type ClaimRunNowArgs = Parameters<StoredJobStore['claimRunNowOwned']>

type OwnedJobMethods =
  | 'listOwned'
  | 'findOwned'
  | 'findOwnedByPrefix'
  | 'pauseOwned'
  | 'resumeOwned'
  | 'claimRunNowOwned'
  | 'releaseRunNowClaimOwned'
  | 'clearRunNowClaims'

type EventJobMethods = 'matchEvent' | 'claimEventFire'

export function createJobStore(db: Storage, dialect: Dialect, logger: Logger): StoredJobStore {
  const sql = buildJobSql(dialect)
  return {
    ...createSchedulerOperations(db, sql, logger),
    ...createOwnedOperations(db, sql, logger),
    ...createEventOperations(db, sql, logger),
  }
}

// An event job is the row and its trigger, so the two land together or not at all. A row that is
// already there is left alone and reported.
async function createJob(db: Storage, sql: JobSql, job: StoredJob): Promise<boolean> {
  const now = Date.now()
  const { event } = job

  if (event === undefined) {
    return (await db.execute(sql.create, toJobParams(job, now))).changes > 0
  }

  return await db.transaction(async (tx) => {
    const result = await tx.execute(sql.create, toJobParams(job, now))

    if (result.changes === 0) {
      return false
    }

    await tx.execute(sql.putTrigger, toTriggerParams(job.id, event, now))

    return true
  })
}

// Only the edited fields are written, in one transaction, so the scheduler's own writes to the
// next-run and failure columns are never overwritten with a stale copy of the row.
async function editJob(
  db: Storage,
  sql: JobSql,
  target: { readonly id: JobId; readonly edit: StoredJobEdit }
): Promise<boolean> {
  const { id, edit } = target
  const statements: (readonly [string, readonly unknown[]])[] = []

  if (edit.prompt !== undefined) {
    statements.push([sql.editPrompt, [edit.prompt, id]])
  }

  if (edit.target !== undefined) {
    statements.push([sql.editTarget, [edit.target.channel, edit.target.chatId, id]])
  }

  if (edit.schedule !== undefined) {
    const { schedule, nextRunAt } = edit.schedule

    statements.push([sql.editSchedule, [...toScheduleParams(schedule), nextRunAt, id]])
  }

  return await db.transaction(async (tx) => {
    let found = false

    for (const [statement, params] of statements) {
      found = (await tx.execute(statement, params)).changes > 0

      if (!found) {
        return false
      }
    }

    return found
  })
}

function createEventOperations(
  db: Storage,
  sql: JobSql,
  logger: Logger
): Pick<StoredJobStore, EventJobMethods> {
  return {
    async matchEvent(match: StoredEventMatch): Promise<readonly StoredJob[]> {
      const rows = await db.query<JobRow>(sql.matchEvent, [
        ENABLED,
        match.event,
        match.alertId,
        match.market,
        match.ticker,
      ])

      return mapJobs(rows, logger)
    },

    async claimEventFire(fire: StoredEventFire): Promise<boolean> {
      const result = await db.execute(sql.claimEventFire, [
        fire.jobId,
        fire.fireKey,
        fire.firedAt,
        fire.firedAt - fire.cooldownMs,
      ])

      return result.changes > 0
    },
  }
}

// A batch read skips the rows it cannot map instead of failing whole. One unreadable row would
// otherwise take every scheduled job with it: `due()` throws on every tick, and `list()` throws
// for the schedule tool, so nothing can run and nothing can remove the row that broke it.
// A single-row lookup still throws — there is no healthy remainder to preserve there.
function mapJobs(rows: readonly JobRow[], logger: Logger): readonly StoredJob[] {
  const jobs: StoredJob[] = []

  for (const row of rows) {
    try {
      jobs.push(toJob(row))
    } catch (err: unknown) {
      logger.error('scheduler.job_row_unreadable', { jobId: row.id, err: formatErrForLog(err) })
    }
  }

  return jobs
}

function createSchedulerOperations(
  db: Storage,
  sql: JobSql,
  logger: Logger
): Omit<StoredJobStore, OwnedJobMethods | EventJobMethods> {
  return {
    async due(
      nowMs: number,
      limit: number,
      runNowClaimStaleBeforeMs: number
    ): Promise<readonly StoredJob[]> {
      const rows = await db.query<JobRow>(sql.due, [
        ENABLED,
        nowMs,
        runNowClaimStaleBeforeMs,
        limit,
      ])
      return mapJobs(rows, logger)
    },

    async advance(id: JobId, nextRunAt: number): Promise<void> {
      await db.execute(sql.advance, [nextRunAt, id])
    },

    async disable(id: JobId): Promise<void> {
      await db.execute(sql.disable, [id])
    },

    async deferRetry(id: JobId, failures: number, nextRunAt: number): Promise<void> {
      await db.execute(sql.deferRetry, [failures, nextRunAt, id])
    },

    create: (job: StoredJob): Promise<boolean> => createJob(db, sql, job),

    edit: (id: JobId, edit: StoredJobEdit): Promise<boolean> => editJob(db, sql, { id, edit }),

    ...createStateOperations(db, sql, logger),
    ...createRunNowOperations(db, sql),

    async list(): Promise<readonly StoredJob[]> {
      const rows = await db.query<JobRow>(sql.list)
      return mapJobs(rows, logger)
    },

    async find(id: JobId): Promise<StoredJob | undefined> {
      const rows = await db.query<JobRow>(sql.find, [id])
      const row = rows[0]
      return row === undefined ? undefined : toJob(row)
    },

    async findByPrefix(prefix: string, limit: number): Promise<readonly StoredJob[]> {
      const rows = await db.query<JobRow>(sql.findByPrefix, [toLikePrefixPattern(prefix), limit])
      return mapJobs(rows, logger)
    },

    async remove(id: JobId): Promise<void> {
      await db.execute(sql.remove, [id])
    },
  }
}

function createRunNowOperations(
  db: Storage,
  sql: JobSql
): Pick<StoredJobStore, 'claimRunNow' | 'releaseRunNowClaim'> {
  return {
    claimRunNow: async (
      id: JobId,
      token: string,
      claimedAtMs: number
    ): Promise<StoredJob | undefined> => {
      const result = await db.execute(sql.claimRunNow, [token, claimedAtMs, id, ENABLED])

      if (result.changes === 0) {
        return undefined
      }

      const rows = await db.query<JobRow>(sql.find, [id])
      const row = rows[0]

      return row === undefined ? undefined : toJob(row)
    },

    releaseRunNowClaim: async (id: JobId, token: string): Promise<void> => {
      await db.execute(sql.releaseRunNow, [id, token])
    },
  }
}

function createStateOperations(
  db: Storage,
  sql: JobSql,
  logger: Logger
): Pick<StoredJobStore, 'pause' | 'resume' | 'listEnabledOfAgent'> {
  return {
    async listEnabledOfAgent(agentId: string): Promise<readonly StoredJob[]> {
      return mapJobs(await db.query<JobRow>(sql.listEnabledOfAgent, [agentId, ENABLED]), logger)
    },

    async pause(id: JobId): Promise<boolean> {
      const result = await db.execute(sql.pause, [id])
      return result.changes > 0
    },
    async resume(id: JobId, nextRunAt: number): Promise<boolean> {
      const result = await db.execute(sql.resume, [nextRunAt, id])
      return result.changes > 0
    },
  }
}

function createOwnedOperations(
  db: Storage,
  sql: JobSql,
  logger: Logger
): Pick<StoredJobStore, OwnedJobMethods> {
  const findOwned = async (owner: StoredJobOwner, id: JobId): Promise<StoredJob | undefined> => {
    const rows = await db.query<JobRow>(sql.findOwned, [id, ...ownerParams(owner)])
    const row = rows[0]
    return row === undefined ? undefined : toJob(row)
  }

  return {
    listOwned: async (owner: StoredJobOwner): Promise<readonly StoredJob[]> => {
      const rows = await db.query<JobRow>(sql.listOwned, ownerParams(owner))
      return mapJobs(rows, logger)
    },

    findOwned,

    findOwnedByPrefix: async (
      owner: StoredJobOwner,
      prefix: string,
      limit: number
    ): Promise<readonly StoredJob[]> => {
      const rows = await db.query<JobRow>(sql.findOwnedByPrefix, [
        toLikePrefixPattern(prefix),
        ...ownerParams(owner),
        limit,
      ])
      return mapJobs(rows, logger)
    },

    pauseOwned: async (owner: StoredJobOwner, id: JobId): Promise<boolean> => {
      const result = await db.execute(sql.pauseOwned, [id, ...ownerParams(owner)])
      return result.changes > 0
    },

    resumeOwned: async (owner: StoredJobOwner, id: JobId, nextRunAt: number): Promise<boolean> => {
      const result = await db.execute(sql.resumeOwned, [nextRunAt, id, ...ownerParams(owner)])
      return result.changes > 0
    },

    claimRunNowOwned: async (...args: ClaimRunNowArgs): Promise<StoredJob | undefined> => {
      const [owner, id, token, claimedAtMs] = args
      const result = await db.execute(sql.claimRunNowOwned, [
        token,
        claimedAtMs,
        id,
        ...ownerParams(owner),
        ENABLED,
      ])

      return result.changes === 0 ? undefined : findOwned(owner, id)
    },

    releaseRunNowClaimOwned: async (
      owner: StoredJobOwner,
      id: JobId,
      token: string
    ): Promise<void> => {
      await db.execute(sql.releaseRunNowClaimOwned, [id, ...ownerParams(owner), token])
    },

    clearRunNowClaims: async (claimedBeforeMs: number): Promise<void> => {
      await db.execute(sql.clearRunNowClaims, [claimedBeforeMs])
    },
  }
}
