import type { DbTable } from '@/persistence/api'
import type { ListAccountsOptions } from '@/trading/features/market-data/store/accounts'
import type { UpsertBarsOptions } from '@/trading/features/market-data/store/bar-writes'
import type {
  DaysFromOptions,
  LatestDay,
  LatestDaysOptions,
} from '@/trading/features/market-data/store/coverage'
import type { FindFundingOptions } from '@/trading/features/market-data/store/funding'
import type {
  ListInstrumentsOptions,
  ReplaceInstrumentsOptions,
} from '@/trading/features/market-data/store/instrument'
import type {
  DeleteMacroOptions,
  ListMacroOptions,
  MacroBeforeOptions,
  MacroVersionOptions,
} from '@/trading/features/market-data/store/macro'
import type {
  DayWindowOptions,
  TradeSidesDayOptions,
} from '@/trading/features/market-data/store/market-snapshot'
import type { ListRefreshAttemptsOptions } from '@/trading/features/market-data/store/refresh-attempt'
import type {
  FindLatestSeriesPointOptions,
  StoredSeriesPoint,
} from '@/trading/features/market-data/store/series-point'
import type { InstrumentRef, MarketRef, Ticker, TradingDay } from '@/trading/kernel/instrument'
import type {
  AnnualAccounts,
  FiledAccounts,
  QuarterlyAccounts,
} from '@/trading/kernel/market/annual-accounts'
import type { MacroRiskSnapshot } from '@/trading/kernel/market/market-capability'
import type {
  BarAdjustment,
  BarRecord,
  DailyTradeSides,
  FlowSnapshot,
  FundamentalSnapshot,
  FundingSnapshot,
  InstrumentRecord,
} from '@/trading/kernel/market/market-data'
import type { MarketRefreshAttempt } from '@/trading/kernel/market/refresh'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { MS_PER_DAY } from '@/core/utils/time'
import { dbTable } from '@/persistence/api'
import {
  listAnnualAccounts,
  listQuarterlyAccounts,
  upsertAccounts,
} from '@/trading/features/market-data/store/accounts'
import { upsertBars } from '@/trading/features/market-data/store/bar-writes'
import {
  listBarCloses,
  listDeskDays,
  listLatestBars,
  listLatestFlowDays,
} from '@/trading/features/market-data/store/coverage'
import { findFunding, upsertFunding } from '@/trading/features/market-data/store/funding'
import {
  findInstrument,
  hasInstruments,
  listInstruments,
  replaceInstruments,
} from '@/trading/features/market-data/store/instrument'
import {
  deleteMacroRiskBefore,
  findLatestMacroRisk,
  findMacroRiskBefore,
  listRecentMacroRisk,
  upsertMacroRisk,
} from '@/trading/features/market-data/store/macro'
import {
  findLatestFundamental,
  listFlows,
  listSharesOutstanding,
  listTradeSides,
  listTradeSidesDay,
  upsertFlows,
  upsertFundamentals,
  upsertTradeSides,
} from '@/trading/features/market-data/store/market-snapshot'
import {
  listRefreshAttempts,
  upsertRefreshAttempt,
} from '@/trading/features/market-data/store/refresh-attempt'
import { findLatestSeriesPoint } from '@/trading/features/market-data/store/series-point'
import { ticker as brandTicker, marketRef, tradingDay } from '@/trading/kernel/instrument'
import { BAR_ADJUSTMENTS } from '@/trading/kernel/market/market-data'
import { sourceId } from '@/trading/kernel/source/source-id'
import { toMember } from '@/trading/kernel/store/store-payload'

/** Every per-market scope an age sweep touches, in delete order. Macro is keyed by region and has
 *  its own day-scoped delete, so it is not a member. */
export const RETENTION_SCOPES = Object.freeze([
  'bars',
  'fundamentals',
  'annualAccounts',
  'quarterlyAccounts',
  'flows',
  'tradeSides',
  'funding',
] as const)
type RetentionScope = (typeof RETENTION_SCOPES)[number]

// Keys come from the shared registry rather than being restated: the sweep deletes by primary key,
// which is the same column list `db export` cursors its pages on.
const RETENTION_TABLES = {
  bars: dbTable('daily_bars'),
  fundamentals: dbTable('fundamental_snapshots'),
  annualAccounts: dbTable('annual_accounts'),
  quarterlyAccounts: dbTable('quarterly_accounts'),
  flows: dbTable('foreign_flow_snapshots'),
  tradeSides: dbTable('daily_trade_sides'),
  funding: dbTable('funding_snapshots'),
} as const satisfies Record<RetentionScope, DbTable>

const DAYS_PER_YEAR = 365

/** How far back a fundamental stability read may look: five years, twenty filings, the span of the
 *  one quality sub-factor with measured support behind it. The decade the practitioner checklists
 *  name is a US large-cap convention and is not free here - a snapshot is re-stamped every session
 *  and only its price-derived fields move, so each year of window keeps ~176k re-stamps around the
 *  ~2.8k filing rows it is actually for. The re-stamps stay regardless of the span:
 *  `findLatestFundamental` answers a point-in-time question from them, and a stored suggestion
 *  cites the accounts it was scored on. Code-owned like the bar window beside it - set short, it
 *  destroys history nothing can refetch, silently. */
const ARCHIVE_RETENTION_YEARS = 5
const ARCHIVE_RETENTION_MS = ARCHIVE_RETENTION_YEARS * DAYS_PER_YEAR * MS_PER_DAY

/** Scopes whose rows no provider will serve again: it publishes the current filing, never last
 *  year's. `tradeSides` is unrepeatable too and deliberately absent - it grows per ticker per
 *  session rather than per reporting period, and nothing reads it past its own twenty-session
 *  window. Not keyed off `durable` in `persistence/tables.ts`: that flag answers whether a row must
 *  be exported to survive a reset, which is a different question with a different answer here. */
const ARCHIVED_RETENTION_SCOPES: ReadonlySet<RetentionScope> = new Set(['fundamentals'])

/** The bar-driven window for anything a refetch can rebuild, and the longer of the two for anything
 *  it cannot. Never shorter than the bar window: a market declaring an evidence window past the
 *  archive span must not have its filings cut back to less than its own series. */
export function retentionMsOf(scope: RetentionScope, barRetentionMs: number): number {
  return ARCHIVED_RETENTION_SCOPES.has(scope)
    ? Math.max(barRetentionMs, ARCHIVE_RETENTION_MS)
    : barRetentionMs
}

interface BarRow {
  readonly market: string
  readonly ticker: string
  readonly day: string
  readonly source_id: string
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  readonly volume: number
  readonly turnover: number | null
  readonly adjustment: string
  readonly fetched_at: number
}

interface SessionDaysOptions {
  readonly market: MarketRef
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
  readonly signal: AbortSignal
}

interface DeleteExpiredOptions {
  readonly scope: RetentionScope
  readonly market: MarketRef
  readonly fetchedBefore: number
  readonly limit: number
  readonly signal: AbortSignal
}

/** One stored reference point: a daily value behind a percentile reading. The series id is the whole
 *  per-series schema, so a second series costs no migration. */
interface SeriesPoint {
  readonly day: TradingDay
  readonly value: number
}

interface UpsertSeriesPointOptions {
  readonly seriesId: string
  readonly day: TradingDay
  readonly value: number
  /** A recorded day keeps its value unless the caller is correcting it: an ordinary re-run must not
   *  silently re-base a reading percentiles were already taken from. */
  readonly replace: boolean
  readonly now: number
  readonly signal: AbortSignal
}

interface ListSeriesPointsOptions {
  readonly seriesId: string
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
  readonly signal: AbortSignal
}

export interface MarketDataStore {
  replaceInstruments(options: ReplaceInstrumentsOptions): Promise<void>
  listInstruments(options: ListInstrumentsOptions): Promise<readonly InstrumentRecord[]>
  findInstrument(options: {
    readonly instrument: InstrumentRef
    readonly signal: AbortSignal
  }): Promise<InstrumentRecord | null>
  /** Whether this market has a stored universe at all. `findInstrument` returning null cannot tell
   *  an unlisted name from a scope that was never refreshed; this separates the two without
   *  reading the scope. */
  hasInstruments(options: {
    readonly market: MarketRef
    readonly signal: AbortSignal
  }): Promise<boolean>
  /** The instruments whose new bars would have joined a different adjustment basis to the history
   *  around the window. Nothing was written for them; every other name in the pass was. */
  upsertBars(options: UpsertBarsOptions): Promise<readonly InstrumentRef[]>
  listBars(options: DayWindowOptions): Promise<readonly BarRecord[]>
  /** The days this market actually traded, ascending — a session is a day that produced a bar.
   *  Market-scoped, not instrument-scoped: a halted name missing one day did not close the
   *  exchange. This is the only retrospective answer to "how many sessions passed"; the calendar
   *  can project forward but cannot know which past days the market was shut. */
  listSessionDays(options: SessionDaysOptions): Promise<readonly TradingDay[]>
  upsertFundamentals(records: readonly FundamentalSnapshot[], signal: AbortSignal): Promise<void>
  /** The newest accounts published at or before `asOf`. The day is required rather than optional:
   *  a reading dated to a past session must not be priced off accounts filed after it, and a
   *  caller that could omit the day would take that look-ahead silently. */
  findLatestFundamental(options: {
    readonly instrument: InstrumentRef
    readonly asOf: TradingDay
    readonly signal: AbortSignal
  }): Promise<FundamentalSnapshot | null>
  upsertAccounts(filed: FiledAccounts, signal: AbortSignal): Promise<void>
  /** Every stored year per name in one market, oldest first. */
  listAnnualAccounts(
    options: ListAccountsOptions
  ): Promise<ReadonlyMap<Ticker, readonly AnnualAccounts[]>>
  /** Every stored quarter per name in one market, oldest first. */
  listQuarterlyAccounts(
    options: ListAccountsOptions
  ): Promise<ReadonlyMap<Ticker, readonly QuarterlyAccounts[]>>
  /** The latest stored share count per ticker, for ratios computed against provider room data. */
  listSharesOutstanding(options: {
    readonly market: MarketRef
    readonly signal: AbortSignal
  }): Promise<ReadonlyMap<Ticker, number>>
  upsertFlows(records: readonly FlowSnapshot[], signal: AbortSignal): Promise<void>
  listFlows(options: DayWindowOptions): Promise<readonly FlowSnapshot[]>
  upsertFunding(records: readonly FundingSnapshot[], signal: AbortSignal): Promise<void>
  /** The settled-day reading a refresh stored; null where no pass has reached that day. */
  findFunding(options: FindFundingOptions): Promise<FundingSnapshot | null>
  upsertTradeSides(records: readonly DailyTradeSides[], signal: AbortSignal): Promise<void>
  /** The stored sessions for one name, ascending by day and window-bounded. */
  listTradeSides(options: DayWindowOptions): Promise<readonly DailyTradeSides[]>
  /** Every name recorded for one session. */
  listTradeSidesDay(options: TradeSidesDayOptions): Promise<readonly DailyTradeSides[]>
  listRefreshAttempts(options: ListRefreshAttemptsOptions): Promise<readonly MarketRefreshAttempt[]>
  upsertRefreshAttempt(attempt: MarketRefreshAttempt, signal: AbortSignal): Promise<void>
  upsertMacroRisk(snapshot: MacroRiskSnapshot, signal: AbortSignal): Promise<void>
  findLatestMacroRisk(options: MacroVersionOptions): Promise<MacroRiskSnapshot | null>
  /** The newest rated read strictly before a day, so a refresh re-running today never leans on
   *  itself. */
  findMacroRiskBefore(options: MacroBeforeOptions): Promise<MacroRiskSnapshot | null>
  listRecentMacroRisk(options: ListMacroOptions): Promise<readonly MacroRiskSnapshot[]>
  /** The newest stored reading of one raw series at or before a day, across formula versions. */
  deleteMacroRiskBefore(options: DeleteMacroOptions): Promise<number>
  listLatestBars(options: LatestDaysOptions): Promise<ReadonlyMap<Ticker, LatestDay>>
  listLatestFlowDays(options: LatestDaysOptions): Promise<ReadonlyMap<Ticker, LatestDay>>
  listBarCloses(
    options: DaysFromOptions
  ): Promise<ReadonlyMap<Ticker, ReadonlyMap<TradingDay, number>>>
  /** The sessions per ticker whose proprietary leg is already settled, so the desk provider is
   *  asked only for the rest. */
  listDeskDays(options: DaysFromOptions): Promise<ReadonlyMap<Ticker, ReadonlySet<TradingDay>>>
  /** The only age-driven delete in this store, bounded by `limit` and driven by retention alone. */
  deleteExpired(options: DeleteExpiredOptions): Promise<number>
  /** Idempotent per (series, day). `false` when the day was already stored and `replace` was not
   *  asked for, so a caller counting what it wrote never reports a discarded row as written. */
  upsertSeriesPoint(options: UpsertSeriesPointOptions): Promise<boolean>
  /** The stored history for a series, ascending by day and window-bounded — the input a percentile
   *  ranks a new reading against. */
  listSeriesPoints(options: ListSeriesPointsOptions): Promise<readonly SeriesPoint[]>
  /** The newest-day point of a series with the instant it was last written, or null for a series
   *  nothing has stored. */
  findLatestSeriesPoint(options: FindLatestSeriesPointOptions): Promise<StoredSeriesPoint | null>
}

export function createMarketDataStore(deps: StoreDeps): MarketDataStore {
  return {
    replaceInstruments: (options) => replaceInstruments(deps, options),
    listInstruments: (options) => listInstruments(deps, options),
    findInstrument: (options) => findInstrument(deps, options),
    hasInstruments: (options) => hasInstruments(deps, options),
    upsertBars: (options) => upsertBars(deps, options),
    listBars: (options) => listBars(deps, options),
    listSessionDays: (options) => listSessionDays(deps, options),
    upsertFundamentals: (records, signal) => upsertFundamentals(deps, records, signal),
    findLatestFundamental: (options) => findLatestFundamental(deps, options),
    upsertAccounts: (filed, signal) => upsertAccounts(deps, filed, signal),
    listAnnualAccounts: (options) => listAnnualAccounts(deps, options),
    listQuarterlyAccounts: (options) => listQuarterlyAccounts(deps, options),
    listSharesOutstanding: (options) => listSharesOutstanding(deps, options),
    upsertFlows: (records, signal) => upsertFlows(deps, records, signal),
    listFlows: (options) => listFlows(deps, options),
    upsertFunding: (records, signal) => upsertFunding(deps, records, signal),
    findFunding: (options) => findFunding(deps, options),
    upsertTradeSides: (records, signal) => upsertTradeSides(deps, records, signal),
    listTradeSides: (options) => listTradeSides(deps, options),
    listTradeSidesDay: (options) => listTradeSidesDay(deps, options),
    listRefreshAttempts: (options) => listRefreshAttempts(deps, options),
    upsertRefreshAttempt: (attempt, signal) => upsertRefreshAttempt(deps, attempt, signal),
    upsertMacroRisk: (snapshot, signal) => upsertMacroRisk(deps, snapshot, signal),
    findLatestMacroRisk: (options) => findLatestMacroRisk(deps, options),
    findMacroRiskBefore: (options) => findMacroRiskBefore(deps, options),
    listRecentMacroRisk: (options) => listRecentMacroRisk(deps, options),
    listLatestBars: (options) => listLatestBars(deps, options),
    listLatestFlowDays: (options) => listLatestFlowDays(deps, options),
    listBarCloses: (options) => listBarCloses(deps, options),
    listDeskDays: (options) => listDeskDays(deps, options),
    deleteMacroRiskBefore: (options) => deleteMacroRiskBefore(deps, options),
    deleteExpired: (options) => deleteExpired(deps, options),
    upsertSeriesPoint: (options) => upsertSeriesPoint(deps, options),
    listSeriesPoints: (options) => listSeriesPoints(deps, options),
    findLatestSeriesPoint: (options) => findLatestSeriesPoint(deps, options),
  }
}

async function listSessionDays(
  deps: StoreDeps,
  options: SessionDaysOptions
): Promise<readonly TradingDay[]> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<{ readonly day: string }>(
    `SELECT DISTINCT day FROM daily_bars WHERE market = ${p(1)} ` +
      `AND day >= ${p(2)} AND day <= ${p(3)} ORDER BY day`,
    [options.market, options.fromDay, options.toDay]
  )

  return rows.map((row) => tradingDay(row.day))
}

async function listBars(deps: StoreDeps, options: DayWindowOptions): Promise<readonly BarRecord[]> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<BarRow>(
    `SELECT * FROM daily_bars WHERE market = ${p(1)} AND ticker = ${p(2)} ` +
      `AND day >= ${p(3)} AND day <= ${p(4)} ORDER BY day`,
    [options.instrument.market, options.instrument.ticker, options.fromDay, options.toDay]
  )

  return rows.map(toBarRecord)
}

async function deleteExpired(deps: StoreDeps, options: DeleteExpiredOptions): Promise<number> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const scope = RETENTION_TABLES[options.scope]
  const keys = scope.pk.join(', ')
  const result = await deps.db.execute(
    `DELETE FROM ${scope.name} WHERE (${keys}) IN (` +
      `SELECT ${keys} FROM ${scope.name} WHERE market = ${p(1)} AND fetched_at < ${p(2)} ` +
      `LIMIT ${p(3)})`,
    [options.market, options.fetchedBefore, options.limit]
  )

  return result.changes
}

function toBarRecord(row: BarRow): BarRecord {
  return {
    sourceId: sourceId(row.source_id),
    fetchedAt: row.fetched_at,
    instrument: { market: marketRef(row.market), ticker: brandTicker(row.ticker) },
    candle: {
      at: tradingDay(row.day),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      adjustment: toMember<BarAdjustment>(row.adjustment, BAR_ADJUSTMENTS, 'bar adjustment'),
    },
    ...(row.turnover === null ? {} : { turnover: row.turnover }),
  }
}

async function upsertSeriesPoint(
  deps: StoreDeps,
  options: UpsertSeriesPointOptions
): Promise<boolean> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const conflict = options.replace
    ? 'DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at'
    : 'DO NOTHING'

  const result = await deps.db.execute(
    `INSERT INTO series_points (series_id, day, value, fetched_at) VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}) ` +
      `ON CONFLICT (series_id, day) ${conflict}`,
    [options.seriesId, options.day, options.value, options.now]
  )

  return result.changes === 1
}

async function listSeriesPoints(
  deps: StoreDeps,
  options: ListSeriesPointsOptions
): Promise<readonly SeriesPoint[]> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<{ day: string; value: number }>(
    `SELECT day, value FROM series_points ` +
      `WHERE series_id = ${p(1)} AND day >= ${p(2)} AND day <= ${p(3)} ORDER BY day ASC`,
    [options.seriesId, options.fromDay, options.toDay]
  )

  return rows.map((row) => ({ day: tradingDay(row.day), value: row.value }))
}
