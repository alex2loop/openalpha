import type { Dialect } from '@/core/types/storage'

const JOB_COLS = [
  'agent_id',
  'prompt',
  'allowed_tools',
  'schedule_kind',
  'cron_expr',
  'cron_tz',
  'every_ms',
  'run_at',
  'next_run_at',
  'target_channel',
  'target_chat_id',
  'enabled',
  'consecutive_failures',
  'user_id',
  'channel',
  'chat_id',
  'created_at',
] as const

export interface JobSql {
  readonly due: string
  readonly advance: string
  readonly disable: string
  readonly deferRetry: string
  readonly create: string
  readonly put: string
  readonly list: string
  readonly find: string
  readonly findByPrefix: string
  readonly findOwnedByPrefix: string
  readonly remove: string
  readonly pause: string
  readonly resume: string
  readonly listOwned: string
  readonly findOwned: string
  readonly pauseOwned: string
  readonly resumeOwned: string
  readonly claimRunNow: string
  readonly claimRunNowOwned: string
  readonly releaseRunNow: string
  readonly releaseRunNowClaimOwned: string
  readonly clearRunNowClaims: string
}

export function buildJobSql(dialect: Dialect): JobSql {
  return {
    // A run_now claim gates cadence only while it might still be live: past `runNowClaimStaleBeforeMs`
    // it can only be a claim whose process died mid-run, and the job must not stay paused for it.
    due:
      `SELECT * FROM jobs WHERE enabled = ${dialect.param(1)} AND next_run_at <= ${dialect.param(2)} ` +
      `AND (run_now_token IS NULL OR run_now_claimed_at < ${dialect.param(3)}) ` +
      `ORDER BY next_run_at LIMIT ${dialect.param(4)}`,
    advance:
      `UPDATE jobs SET next_run_at = ${dialect.param(1)}, consecutive_failures = 0 ` +
      `WHERE id = ${dialect.param(2)}`,
    disable: `UPDATE jobs SET enabled = 0, consecutive_failures = 0 WHERE id = ${dialect.param(1)}`,
    deferRetry:
      `UPDATE jobs SET consecutive_failures = ${dialect.param(1)}, next_run_at = ${dialect.param(2)} ` +
      `WHERE id = ${dialect.param(3)}`,
    create:
      `INSERT INTO jobs (${['id', ...JOB_COLS].join(', ')}) ` +
      `VALUES (${dialect.paramList(JOB_COLS.length + 1)}) ON CONFLICT (id) DO NOTHING`,
    put: dialect.upsert('jobs', { keys: ['id'], cols: [...JOB_COLS], rowCount: 1 }),
    list: 'SELECT * FROM jobs ORDER BY next_run_at',
    find: `SELECT * FROM jobs WHERE id = ${dialect.param(1)}`,
    findByPrefix: `SELECT * FROM jobs WHERE id LIKE ${dialect.param(1)} ESCAPE '\\' ORDER BY id LIMIT ${dialect.param(2)}`,
    findOwnedByPrefix:
      `SELECT * FROM jobs WHERE id LIKE ${dialect.param(1)} ESCAPE '\\' ` +
      `AND user_id = ${dialect.param(2)} AND channel = ${dialect.param(3)} AND chat_id = ${dialect.param(4)} ` +
      `ORDER BY id LIMIT ${dialect.param(5)}`,
    remove: `DELETE FROM jobs WHERE id = ${dialect.param(1)}`,
    ...buildStateSql(dialect),
    listOwned:
      `SELECT * FROM jobs WHERE user_id = ${dialect.param(1)} AND channel = ${dialect.param(2)} ` +
      `AND chat_id = ${dialect.param(3)} ORDER BY next_run_at`,
    findOwned:
      `SELECT * FROM jobs WHERE id = ${dialect.param(1)} AND user_id = ${dialect.param(2)} ` +
      `AND channel = ${dialect.param(3)} AND chat_id = ${dialect.param(4)}`,
    pauseOwned:
      `UPDATE jobs SET enabled = 0, run_now_token = NULL, run_now_claimed_at = NULL ` +
      `WHERE id = ${dialect.param(1)} AND user_id = ${dialect.param(2)} AND channel = ${dialect.param(3)} ` +
      `AND chat_id = ${dialect.param(4)}`,
    resumeOwned:
      `UPDATE jobs SET enabled = 1, next_run_at = ${dialect.param(1)}, consecutive_failures = 0, ` +
      `run_now_token = NULL, run_now_claimed_at = NULL WHERE id = ${dialect.param(2)} ` +
      `AND user_id = ${dialect.param(3)} AND channel = ${dialect.param(4)} AND chat_id = ${dialect.param(5)}`,
    ...buildRunNowSql(dialect),
  }
}

type StateSql = Pick<JobSql, 'pause' | 'resume'>

function buildStateSql(dialect: Dialect): StateSql {
  return {
    pause:
      `UPDATE jobs SET enabled = 0, run_now_token = NULL, run_now_claimed_at = NULL ` +
      `WHERE id = ${dialect.param(1)}`,
    resume:
      `UPDATE jobs SET enabled = 1, next_run_at = ${dialect.param(1)}, consecutive_failures = 0, ` +
      `run_now_token = NULL, run_now_claimed_at = NULL WHERE id = ${dialect.param(2)}`,
  }
}

type RunNowSql = Pick<
  JobSql,
  | 'claimRunNow'
  | 'releaseRunNow'
  | 'claimRunNowOwned'
  | 'releaseRunNowClaimOwned'
  | 'clearRunNowClaims'
>

function buildRunNowSql(dialect: Dialect): RunNowSql {
  // A scheduled occurrence with a live lease is still running this job; a run-now beside it would
  // execute the same prompt twice. Run-now rows carry no lease, so they never match.
  const noLiveOccurrence =
    `NOT EXISTS (SELECT 1 FROM scheduler_runs WHERE scheduler_runs.job_id = jobs.id ` +
    `AND scheduler_runs.status = 'running' AND scheduler_runs.lease_until > ${dialect.param(2)})`

  return {
    claimRunNow:
      `UPDATE jobs SET run_now_token = ${dialect.param(1)}, run_now_claimed_at = ${dialect.param(2)} ` +
      `WHERE id = ${dialect.param(3)} AND enabled = ${dialect.param(4)} AND run_now_token IS NULL ` +
      `AND ${noLiveOccurrence}`,
    releaseRunNow:
      `UPDATE jobs SET run_now_token = NULL, run_now_claimed_at = NULL WHERE id = ${dialect.param(1)} ` +
      `AND run_now_token = ${dialect.param(2)}`,
    claimRunNowOwned:
      `UPDATE jobs SET run_now_token = ${dialect.param(1)}, run_now_claimed_at = ${dialect.param(2)} ` +
      `WHERE id = ${dialect.param(3)} AND user_id = ${dialect.param(4)} AND channel = ${dialect.param(5)} ` +
      `AND chat_id = ${dialect.param(6)} AND enabled = ${dialect.param(7)} AND run_now_token IS NULL ` +
      `AND ${noLiveOccurrence}`,
    releaseRunNowClaimOwned:
      `UPDATE jobs SET run_now_token = NULL, run_now_claimed_at = NULL WHERE id = ${dialect.param(1)} ` +
      `AND user_id = ${dialect.param(2)} AND channel = ${dialect.param(3)} AND chat_id = ${dialect.param(4)} ` +
      `AND run_now_token = ${dialect.param(5)}`,
    clearRunNowClaims:
      `UPDATE jobs SET run_now_token = NULL, run_now_claimed_at = NULL ` +
      `WHERE run_now_claimed_at < ${dialect.param(1)}`,
  }
}
