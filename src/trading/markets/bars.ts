import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentRef, MarketRef, TradingDay } from '@/trading/kernel/instrument'
import type { BarsRequest, InstrumentRequest } from '@/trading/kernel/market/market-capability'
import type { BarRecord, Candle } from '@/trading/kernel/market/market-data'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { TargetOutcome } from '@/trading/markets/refresh-result'
import type { TradingCalendar } from '@/trading/markets/types'
import { sourcedCaveat } from '@/trading/kernel/caveat'
import { available } from '@/trading/kernel/source/source-result'
import { resolveSettledDay } from '@/trading/markets/calendar'

/** How far short of the requested day a stored tail may fall and still answer. A weekend plus a
 *  holiday is the longest a provider outage should be papered over; past that an honest refusal
 *  beats a series a reader would take for current. */
const STALE_BARS_MAXIMUM_SESSIONS = 3

/** Share of the requested sessions a stored tail must hold to answer as the window itself. Wide
 *  enough to absorb a year's exchange holidays, narrow enough that a pruned or half-filled series
 *  goes back to the provider instead of being read as the span it was asked for. */
const MINIMUM_WINDOW_COVERAGE_FRACTION = 0.9

export interface BarWindow {
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
  readonly sessions: number
}

/** What a market brings to the shared read: its calendar, the window a request that names no
 *  session count reads, and how it asks its providers for a window the store could not answer. */
export interface SettledBarsPolicy {
  readonly calendar: TradingCalendar
  readonly defaultSessions: number
  readonly fetch: (window: BarWindow) => Promise<SourceResult<readonly Candle[]>>
}

interface StoredBars {
  readonly candles: readonly Candle[]
  readonly newest: BarRecord
}

/** The settled daily series: today's forming bar is never in it, so levels, outcomes, and the bars
 *  tool all read the same sessions. The live price is the quote capability's job. A stored tail
 *  that reaches the day with the depth asked for answers outright; one that falls short waits for
 *  the provider and answers only if the provider cannot. */
export async function settledBars(
  deps: MarketDeps,
  request: BarsRequest,
  policy: SettledBarsPolicy
): Promise<SourceResult<readonly Candle[]>> {
  const window = barWindow(request, policy)
  const stored = await storedBars(deps, request, window)

  if (stored !== null && coversWindow(stored, window)) {
    return storedResult(stored, [])
  }

  const live = await policy.fetch(window)

  if (live.kind === 'available') {
    const stale = staleTailCaveats(live.value, request, window)

    return stale.length === 0 ? live : { ...live, caveats: [...live.caveats, ...stale] }
  }

  if (stored === null) {
    return live
  }

  const staleFloorDay = policy.calendar.addTradingDays(window.toDay, -STALE_BARS_MAXIMUM_SESSIONS)

  if (stored.newest.candle.at < staleFloorDay) {
    return live
  }

  return storedResult(stored, fallbackCaveats(stored, window, live.attemptedSourceIds))
}

/** What the provider says when it answers short of the session asked for. The series still travels
 *  — it is the only evidence there is — but a screen ranks the row against peers priced a session
 *  later, so the name and the day it actually reaches are stated rather than left to the row's own
 *  date line. Per instrument, because one name's short series says nothing about the board. */
function staleTailCaveats(
  candles: readonly Candle[],
  request: BarsRequest,
  window: BarWindow
): readonly Caveat[] {
  const newest = candles[candles.length - 1]

  return newest === undefined || newest.at >= window.toDay
    ? []
    : [
        {
          code: 'market-data.series-stale',
          detail: { ticker: request.instrument.ticker, asOf: newest.at },
        },
      ]
}

/** Depth as well as recency: a tail reaching today but holding a fraction of the sessions asked for
 *  is a different population, and every median taken over it measures a span nobody requested.
 *  Counted rather than dated, and with slack, because the calendar knows only weekends — the
 *  holidays it cannot name make a complete store hold slightly fewer rows than the window's
 *  weekday arithmetic projects, which is not a gap. */
function coversWindow(stored: StoredBars, window: BarWindow): boolean {
  return (
    stored.newest.candle.at >= window.toDay &&
    stored.candles.length >= window.sessions * MINIMUM_WINDOW_COVERAGE_FRACTION
  )
}

/** What the store says when the provider could not be reached. A tail short of the window is served
 *  rather than refused — it is the only evidence left — but never as the window that was asked for.
 *
 *  Named from the attempt, not the stored row: "I couldn't refresh X" is a statement about the
 *  provider that just failed, while the newest bar names whoever happened to write it, which after
 *  a failover is a source this run never asked. A refusal that reached no provider at all - an
 *  unsupported scope, a window judged stale before any call - names none, and the stored row is
 *  then the only source there is to name: `sourcedCaveat` turns an empty list into
 *  `source.no-available-provider`, which would claim every source failed while this very result
 *  serves stored bars. */
function fallbackCaveats(
  stored: StoredBars,
  window: BarWindow,
  attempted: readonly SourceId[]
): readonly Caveat[] {
  const named = attempted.length === 0 ? [stored.newest.sourceId] : attempted
  const stale = sourcedCaveat('source.stale-cache', named, { sourceKind: 'bars' })

  return coversWindow(stored, window)
    ? [stale]
    : [
        stale,
        sourcedCaveat('source.short-window', named, {
          sourceKind: 'bars',
          sessions: stored.candles.length,
          requested: window.sessions,
        }),
      ]
}

/** A past day is settled; today is settled once its session has closed, and a continuous market's
 *  today never is. Never later than the request's own day. */
export function lastSettledDay(request: InstrumentRequest, calendar: TradingCalendar): TradingDay {
  const settled = resolveSettledDay(calendar, request.now)

  return request.asOf < settled ? request.asOf : settled
}

function barWindow(request: BarsRequest, policy: SettledBarsPolicy): BarWindow {
  const sessions = request.sessions > 0 ? request.sessions : policy.defaultSessions
  const toDay = lastSettledDay(request, policy.calendar)

  return { fromDay: policy.calendar.addTradingDays(toDay, -sessions), toDay, sessions }
}

/** The refresh already wrote this market's series, so a suggestion reads the rows its factors read
 *  instead of refetching a year of sessions per run. */
async function storedBars(
  deps: MarketDeps,
  request: BarsRequest,
  window: BarWindow
): Promise<StoredBars | null> {
  const rows = await deps.marketDataStore.listBars({
    instrument: request.instrument,
    fromDay: window.fromDay,
    toDay: window.toDay,
    signal: request.signal,
  })
  const newest = rows[rows.length - 1]

  return newest === undefined ? null : { candles: rows.map((row) => row.candle), newest }
}

/** The freshest bar's stamp, not one per session: repeating it says nothing more. */
function storedResult(
  stored: StoredBars,
  caveats: readonly Caveat[]
): SourceResult<readonly Candle[]> {
  return available(
    stored.candles,
    [{ sourceId: stored.newest.sourceId, fetchedAt: stored.newest.fetchedAt, freshness: 'cached' }],
    caveats
  )
}

/** A fetched series with the window it was fetched over. The two travel together because the delete
 *  that precedes a write must clear exactly that span, and array position is no way to carry it. */
export interface BarWrite {
  readonly outcome: TargetOutcome<readonly BarRecord[]>
  readonly fromDay: TradingDay
}

interface BarWindowWriteOptions {
  readonly deps: Pick<MarketDeps, 'marketDataStore'>
  readonly market: MarketRef
  readonly toDay: TradingDay
  readonly writes: readonly BarWrite[]
  readonly signal: AbortSignal
}

/** What one pass of `writeBarWindows` did. Unexported — the callers destructure it, and naming it
 *  is what lets the function state its own return type. */
interface BarWindowWriteResult {
  readonly recordCount: number
  /** Names whose new bars would have joined a different adjustment basis to the history on either
   *  side of the window. Nothing was written for them; every other name in the pass was. */
  readonly conflicted: readonly InstrumentRef[]
}

/** One delete-and-write per window the pass fetched over, never per name: a full-window delete
 *  paired with a tail fetch erases history, and a tail delete paired with a full fetch leaves the
 *  pre-restatement rows the rebuild exists to replace. A pass holds at most two windows, so it is at
 *  most two commits. Returns the rows written, which is the population the kind now stands for. */
export async function writeBarWindows(
  options: BarWindowWriteOptions
): Promise<BarWindowWriteResult> {
  const windows = new Map<TradingDay, BarRecord[]>()
  let recordCount = 0

  for (const write of options.writes) {
    const records = write.outcome.value

    if (records === undefined) {
      continue
    }

    const held = windows.get(write.fromDay)

    recordCount += records.length

    if (held === undefined) {
      windows.set(write.fromDay, [...records])
      continue
    }

    held.push(...records)
  }

  const conflicted: InstrumentRef[] = []

  for (const [fromDay, records] of windows) {
    conflicted.push(
      ...(await options.deps.marketDataStore.upsertBars({
        market: options.market,
        fromDay,
        toDay: options.toDay,
        records,
        signal: options.signal,
      }))
    )
  }

  return { recordCount, conflicted }
}

/** Whether the pass rebuilt a name's whole history rather than catching up its tail. The operator
 *  reads these words, and one that says a full reload after a nightly catch-up describes a run that
 *  did not happen. */
export function hasRebuiltWindow(writes: readonly BarWrite[], historyFromDay: TradingDay): boolean {
  return writes.some(
    (write) => write.outcome.value !== undefined && write.fromDay === historyFromDay
  )
}
