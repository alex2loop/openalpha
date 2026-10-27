import type { Dialect, Transaction } from '@/core/types/storage'
import type { RetentionStatement } from '@/persistence/retention-pages'
import type { DbTable } from '@/persistence/tables'
import { MS_PER_DAY } from '@/core/utils/time'
import { buildPageCount, countRows } from '@/persistence/retention-pages'
import { dbTable } from '@/persistence/tables'

/** The exit plan reads back through a name's newest ten buy and hold rows, and every other read by
 *  name takes its newest row, so the newest ten per name, focus and action outlive any window. */
const SUGGESTIONS_KEEP_PER_NAME = 10
/** The theme report compares each theme's last two runs. */
const THEME_RUNS_KEEP_PER_THEME = 2
/** Past the macro extract's 24-month backfill: a month swept inside it would be read, and paid
 *  for, again. */
const MACRO_DOCUMENTS_MINIMUM_MS = 800 * MS_PER_DAY

export const EMPTY_PAGED_COUNTS = Object.freeze({
  restingExits: 0,
  spentJobs: 0,
  suggestions: 0,
  factorLog: 0,
  themeOutcomes: 0,
  themeReads: 0,
  themeRuns: 0,
  navSnapshots: 0,
  seriesPoints: 0,
  seriesProvenance: 0,
  macroDocuments: 0,
})

export type PagedScopeName = keyof typeof EMPTY_PAGED_COUNTS

export interface PagedCutoffs {
  readonly now: number
  readonly general: number
  readonly history: number
}

/** One table's expired rows: deleted a page at a time, each page in its own transaction. */
interface PagedScope {
  readonly name: PagedScopeName
  readonly table: DbTable
  readonly filter: RetentionStatement
}

export function toPagedScopes(dialect: Dialect, times: PagedCutoffs): readonly PagedScope[] {
  const p = dialect.param
  const macroBefore = Math.min(times.history, times.now - MACRO_DOCUMENTS_MINIMUM_MS)

  return [
    scope('restingExits', 'resting_exits', {
      sql: `state <> 'live' AND placed_at < ${p(1)}`,
      params: [times.general],
    }),
    scope('spentJobs', 'jobs', { sql: spentJobWhere(dialect), params: [times.general] }),
    scope('suggestions', 'suggestions', {
      sql: suggestionWhere(dialect),
      params: [SUGGESTIONS_KEEP_PER_NAME, times.history],
    }),
    scope('factorLog', 'factor_log', { sql: `resolved_at < ${p(1)}`, params: [times.history] }),
    ...themeScopes(dialect, times),
    scope('navSnapshots', 'nav_snapshots', {
      sql: `recorded_at < ${p(1)}`,
      params: [times.history],
    }),
    scope('seriesPoints', 'series_points', {
      sql: `fetched_at < ${p(1)}`,
      params: [times.history],
    }),
    scope('seriesProvenance', 'series_provenance', {
      sql: `extracted_at < ${p(1)}`,
      params: [times.history],
    }),
    scope('macroDocuments', 'macro_documents', {
      sql: `extracted_at < ${p(1)}`,
      params: [macroBefore],
    }),
  ]
}

// Outcomes first, so a run they no longer cite can go, then the run's reads, then the run.
function themeScopes(dialect: Dialect, times: PagedCutoffs): readonly PagedScope[] {
  const runParams = [times.general, THEME_RUNS_KEEP_PER_THEME]

  return [
    scope('themeOutcomes', 'theme_outcomes', {
      sql: `resolved_at < ${dialect.param(1)}`,
      params: [times.history],
    }),
    scope('themeReads', 'theme_reads', {
      sql: `run_id IN (SELECT id FROM theme_runs WHERE ${expiredRunWhere(dialect)})`,
      params: runParams,
    }),
    scope('themeRuns', 'theme_runs', {
      sql:
        `${expiredRunWhere(dialect)} AND NOT EXISTS ` +
        '(SELECT 1 FROM theme_reads WHERE theme_reads.run_id = theme_runs.id)',
      params: runParams,
    }),
  ]
}

export async function countPaged(
  tx: Transaction,
  scopes: readonly PagedScope[]
): Promise<Record<PagedScopeName, number>> {
  const counts: Record<PagedScopeName, number> = { ...EMPTY_PAGED_COUNTS }

  for (const paged of scopes) {
    const { sql, params } = buildPageCount(paged.table, paged.filter)

    counts[paged.name] = await countRows(tx, sql, params)
  }

  return counts
}

function scope(
  name: PagedScopeName,
  table: Parameters<typeof dbTable>[0],
  filter: RetentionStatement
): PagedScope {
  return { name, table: dbTable(table), filter }
}

// A one-shot that ran and was switched off has no later occurrence. One paused before it ran has no
// finished run, and an event job is parked far in the future, so neither matches.
function spentJobWhere(dialect: Dialect): string {
  return (
    `schedule_kind = 'once' AND enabled = 0 AND run_at < ${dialect.param(1)} ` +
    'AND EXISTS (SELECT 1 FROM scheduler_runs WHERE scheduler_runs.job_id = jobs.id ' +
    'AND scheduler_runs.ended_at IS NOT NULL) ' +
    'AND NOT EXISTS (SELECT 1 FROM job_event_triggers WHERE job_event_triggers.job_id = jobs.id)'
  )
}

// An unscored call is never swept: only a hold (which nothing scores) ages by when it was made, and
// a call by when it resolved.
function suggestionWhere(dialect: Dialect): string {
  const before = dialect.param(2)

  return (
    'id IN (SELECT ranked.id FROM (SELECT id, action, created_at, resolved_at, ' +
    'ROW_NUMBER() OVER (PARTITION BY market, ticker, focus_key, action ' +
    'ORDER BY created_at DESC, id DESC) AS rn FROM suggestions) ranked ' +
    `WHERE ranked.rn > ${dialect.param(1)} AND ranked.created_at < ${before} ` +
    `AND (ranked.action = 'hold' OR ranked.resolved_at < ${before}))`
  )
}

// A run stays while an outcome cites it (its reads carry the scores the outcome is judged on), while
// it is among each theme's newest runs, and while it is the newest run or the newest full run.
function expiredRunWhere(dialect: Dialect): string {
  const order = 'ORDER BY newest.started_at DESC, newest.id DESC LIMIT 1'

  return (
    `started_at < ${dialect.param(1)} ` +
    'AND NOT EXISTS (SELECT 1 FROM theme_outcomes WHERE theme_outcomes.run_id = theme_runs.id) ' +
    `AND id NOT IN (SELECT newest.id FROM theme_runs newest ${order}) ` +
    `AND id NOT IN (SELECT newest.id FROM theme_runs newest WHERE newest.theme_id IS NULL ${order}) ` +
    'AND id NOT IN (SELECT ranked.run_id FROM (SELECT head.run_id, ' +
    'ROW_NUMBER() OVER (PARTITION BY head.theme_id ' +
    'ORDER BY runs.started_at DESC, runs.id DESC) AS recency ' +
    "FROM theme_reads head JOIN theme_runs runs ON runs.id = head.run_id WHERE head.level = 'theme') " +
    `ranked WHERE ranked.recency <= ${dialect.param(2)})`
  )
}
