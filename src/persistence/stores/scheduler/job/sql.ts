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

// `jobs.*` rather than `*`: the trigger's own `created_at` must never shadow the job's.
const JOB_SELECT =
  'SELECT jobs.*, t.event AS trigger_event, t.market AS trigger_market, ' +
  't.ticker AS trigger_ticker, t.condition AS trigger_condition, ' +
  't.threshold AS trigger_threshold, t.alert_id AS trigger_alert_id, ' +
  't.cooldown_ms AS trigger_cooldown_ms ' +
  'FROM jobs LEFT JOIN job_event_triggers t ON t.job_id = jobs.id'

const TRIGGER_COLS = [
  'event',
  'market',
  'ticker',
  'condition',
  'threshold',
  'alert_id',
  'cooldown_ms',
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
  readonly putTrigger: string
  readonly matchEvent: string
  readonly claimEventFire: string
}

export function buildJobSql(dialect: Dialect): JobSql {
  return {
    // A run_now claim gates cadence only while it might still be live: past `runNowClaimStaleBeforeMs`
    // it can only be a claim whose process died mid-run, and the job must not stay paused for it.
    due:
      `${JOB_SELECT} WHERE enabled = ${dialect.param(1)} AND next_run_at <= ${dialect.param(2)} ` +
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
    list: `${JOB_SELECT} ORDER BY next_run_at`,
    find: `${JOB_SELECT} WHERE jobs.id = ${dialect.param(1)}`,
    findByPrefix: `${JOB_SELECT} WHERE jobs.id LIKE ${dialect.param(1)} ESCAPE '\\' ORDER BY jobs.id LIMIT ${dialect.param(2)}`,
    findOwnedByPrefix:
      `${JOB_SELECT} WHERE jobs.id LIKE ${dialect.param(1)} ESCAPE '\\' ` +
      `AND user_id = ${dialect.param(2)} AND channel = ${dialect.param(3)} AND chat_id = ${dialect.param(4)} ` +
      `ORDER BY jobs.id LIMIT ${dialect.param(5)}`,
    remove: `DELETE FROM jobs WHERE id = ${dialect.param(1)}`,
    ...buildStateSql(dialect),
    ...buildOwnedSql(dialect),
    ...buildEventSql(dialect),
    ...buildRunNowSql(dialect),
  }
}

type OwnedSql = Pick<JobSql, 'listOwned' | 'findOwned' | 'pauseOwned' | 'resumeOwned'>

function buildOwnedSql(dialect: Dialect): OwnedSql {
  return {
    listOwned:
      `${JOB_SELECT} WHERE user_id = ${dialect.param(1)} AND channel = ${dialect.param(2)} ` +
      `AND chat_id = ${dialect.param(3)} ORDER BY next_run_at`,
    findOwned:
      `${JOB_SELECT} WHERE jobs.id = ${dialect.param(1)} AND user_id = ${dialect.param(2)} ` +
      `AND channel = ${dialect.param(3)} AND chat_id = ${dialect.param(4)}`,
    pauseOwned:
      `UPDATE jobs SET enabled = 0, run_now_token = NULL, run_now_claimed_at = NULL ` +
      `WHERE id = ${dialect.param(1)} AND user_id = ${dialect.param(2)} AND channel = ${dialect.param(3)} ` +
      `AND chat_id = ${dialect.param(4)}`,
    resumeOwned:
      `UPDATE jobs SET enabled = 1, next_run_at = ${dialect.param(1)}, consecutive_failures = 0, ` +
      `run_now_token = NULL, run_now_claimed_at = NULL WHERE id = ${dialect.param(2)} ` +
      `AND user_id = ${dialect.param(3)} AND channel = ${dialect.param(4)} AND chat_id = ${dialect.param(5)}`,
  }
}

type EventSql = Pick<JobSql, 'putTrigger' | 'matchEvent' | 'claimEventFire'>

function buildEventSql(dialect: Dialect): EventSql {
  return {
    putTrigger: dialect.upsert('job_event_triggers', {
      keys: ['job_id'],
      cols: [...TRIGGER_COLS],
      rowCount: 1,
    }),
    // A price job is tied to its alert; the others match the name the alert fired on, where an
    // absent market or ticker on the trigger means any.
    matchEvent:
      `${JOB_SELECT} WHERE jobs.enabled = ${dialect.param(1)} AND t.event = ${dialect.param(2)} AND (` +
      `(t.event = 'price' AND t.alert_id = ${dialect.param(3)}) OR ` +
      `(t.event <> 'price' AND (t.market IS NULL OR t.market = ${dialect.param(4)}) ` +
      `AND (t.ticker IS NULL OR t.ticker = ${dialect.param(5)}))) ORDER BY jobs.id`,
    // One statement is the whole claim: the row is taken only when the last fire is a full
    // cooldown old, so two alerts racing for one job cannot both win.
    claimEventFire:
      `INSERT INTO job_event_fires (job_id, fire_key, last_fired_at) ` +
      `VALUES (${dialect.param(1)}, ${dialect.param(2)}, ${dialect.param(3)}) ` +
      `ON CONFLICT (job_id, fire_key) DO UPDATE SET last_fired_at = excluded.last_fired_at ` +
      `WHERE job_event_fires.last_fired_at <= ${dialect.param(4)}`,
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
