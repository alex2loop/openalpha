import type {
  FactorLogExitReason,
  FactorLogId,
  FactorLogOutcome,
  FactorLogResolveBatch,
  FactorLogStore,
  PendingFactorLogEntry,
} from '@/trading/features/suggestion/track-record/factor-log-types'
import type { InstrumentStatus } from '@/trading/kernel/caveat'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { OperationTickOptions } from '@/trading/kernel/store/page'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import { calendarSessionsBetween } from '@/trading/features/market-data/resolve'
import {
  outcomeLookbackSessions,
  outcomeWindowSessions,
} from '@/trading/features/suggestion/pipeline/outcome-window'
import { canResolveOutcomes } from '@/trading/features/suggestion/track-record/resolvable'
import { buildInstrumentKey } from '@/trading/kernel/instrument'

/** Sessions the benchmark must print after a name's last bar before the name counts as stopped. Two
 *  trading weeks: long enough that a missed refresh or a short suspension never reads as a stop. */
const STOPPED_TRADING_GRACE_SESSIONS = 10
/** The wait for a name the listing still calls active. A refresh repairs a feed that lost one name
 *  well inside six weeks, and a suspension the listing never reports still books in the end. */
const LISTED_STOPPED_GRACE_SESSIONS = 30

export interface FactorLogResolveDeps {
  readonly markets: MarketRegistry
  readonly store: FactorLogStore
  /** The market's own listing, read from a source apart from the bars. */
  readonly listingStatus: (
    instrument: InstrumentRef,
    signal: AbortSignal
  ) => Promise<InstrumentStatus | undefined>
}

/** One tick's reads. Every row of a market is scored against the same benchmark series, so it is
 *  read once per market per tick, at the full lookback any row can ask for. */
interface ResolvePass {
  readonly deps: FactorLogResolveDeps
  readonly options: OperationTickOptions<FactorLogId>
  readonly benchmarks: Map<string, Promise<readonly Candle[] | undefined>>
}

/** Close-to-close over the market's own horizon window, measured on the session the window ends.
 *  A row whose window has not elapsed, or whose series the source has not completed, stays pending
 *  and is asked again next tick. */
export async function resolvePendingEntries(
  deps: FactorLogResolveDeps,
  options: OperationTickOptions<FactorLogId>
): Promise<FactorLogResolveBatch> {
  const page = await deps.store.listPending(options)
  const pass: ResolvePass = { deps, options, benchmarks: new Map() }
  let resolved = 0

  for (const entry of page.items) {
    const outcome = await resolveOne(pass, entry)

    if (outcome !== undefined && (await deps.store.resolve(entry.id, outcome, options.signal))) {
      resolved += 1
    }
  }

  return {
    resolved,
    pending: page.items.length - resolved,
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  }
}

async function resolveOne(
  pass: ResolvePass,
  entry: PendingFactorLogEntry
): Promise<FactorLogOutcome | undefined> {
  const { options } = pass
  const market = pass.deps.markets.find(entry.instrument.market)

  if (market === null || !canResolveOutcomes(market) || market.capabilities.bars === undefined) {
    return undefined
  }

  const window = outcomeWindowSessions(market.manifest.defaultCalendar, entry.horizon)
  const asOf = market.manifest.calendar.dayAt(options.now)

  const elapsed = calendarSessionsBetween(market, entry.day, asOf)

  if (elapsed <= window) {
    return undefined
  }

  const lookback = outcomeLookbackSessions(market.manifest.defaultCalendar)
  const sessions = elapsed + 1

  // The series is capped at the lookback and must reach the logged session, so a row past it can
  // never be scored and would otherwise be read again on every tick.
  if (sessions > lookback) {
    await pass.deps.store.closeUnscorable(entry.id, options.signal)

    return undefined
  }

  const query: SeriesQuery = {
    market,
    instrument: entry.instrument,
    asOf,
    sessions,
    now: options.now,
    signal: options.signal,
  }
  const bars = await barsSince(query)

  if (bars === undefined) {
    return undefined
  }

  const benchmarkBars = await benchmarkSeries(pass, { ...query, sessions: lookback })
  const exit =
    barAtWindowEnd(bars, entry.day, window) ?? stoppedExit({ bars, benchmarkBars, entry, window })
  // Both ends off one series, so a dividend or split re-basing it since the capture moves neither.
  const start = bars.findLast((bar) => bar.at <= entry.day)

  if (exit === undefined || start === undefined || (await isStillListed(pass, entry, exit))) {
    return undefined
  }

  const benchmark = benchmarkReturn(benchmarkBars, entry.day, exit.at)

  return {
    resolvedAt: options.now,
    exitDay: exit.at,
    returnPct: exit.close / start.close - 1,
    exitReason: exit.reason,
    ...(benchmark === undefined ? {} : { benchmarkReturnPct: benchmark }),
  }
}

interface Exit {
  readonly at: TradingDay
  readonly close: number
  readonly reason: FactorLogExitReason
  /** Benchmark sessions printed after the name's last bar, on a stopped-trading exit. */
  readonly silentSessions?: number
}

interface SeriesQuery {
  readonly market: Market
  readonly instrument: InstrumentRef
  readonly asOf: TradingDay
  readonly sessions: number
  readonly now: number
  readonly signal: AbortSignal
}

/** The market's own series from the logged session onward, so the window count is exact. */
async function barsSince(query: SeriesQuery): Promise<readonly Candle[] | undefined> {
  const bars = await query.market.capabilities.bars?.run({
    instrument: query.instrument,
    asOf: query.asOf,
    now: query.now,
    sessions: query.sessions,
    signal: query.signal,
  })

  return bars === undefined || bars.kind !== 'available' ? undefined : bars.value
}

/** The window's last bar: the first `window` closes after the logged session. The series has to
 *  reach back to that session, or a lookback-capped one that starts later would count its own
 *  first bars as the window and score a move the row never saw. */
function barAtWindowEnd(
  bars: readonly Candle[],
  fromDay: TradingDay,
  window: number
): Exit | undefined {
  const first = bars[0]

  if (first === undefined || first.at > fromDay) {
    return undefined
  }

  const last = bars.filter((bar: Candle) => bar.at > fromDay)[window - 1]

  return last === undefined ? undefined : { at: last.at, close: last.close, reason: 'window-end' }
}

function benchmarkSeries(
  pass: ResolvePass,
  query: SeriesQuery
): Promise<readonly Candle[] | undefined> {
  const benchmark = query.market.manifest.benchmark

  if (benchmark === undefined) {
    return Promise.resolve(undefined)
  }

  const key = buildInstrumentKey(benchmark)
  const known = pass.benchmarks.get(key)

  if (known !== undefined) {
    return known
  }

  const read = barsSince({ ...query, instrument: benchmark })

  pass.benchmarks.set(key, read)

  return read
}

/** Over the span the row was scored on, so a name scored at its last close is compared on the same
 *  days. */
function benchmarkReturn(
  bars: readonly Candle[] | undefined,
  fromDay: TradingDay,
  toDay: TradingDay
): number | undefined {
  const start = bars?.find((bar) => bar.at === fromDay)
  const end = bars?.findLast((bar) => bar.at <= toDay)

  return start === undefined || end === undefined || start.close <= 0
    ? undefined
    : end.close / start.close - 1
}

interface StoppedInput {
  readonly bars: readonly Candle[]
  readonly benchmarkBars: readonly Candle[] | undefined
  readonly entry: PendingFactorLogEntry
  readonly window: number
}

/** A name the listing still calls active has more likely lost its bar feed than stopped, so the row
 *  waits for the feed, for the listing to say halted or delisted, or for the longer grace to pass.
 *  A market with no listing record for the name keeps the benchmark rule alone. */
async function isStillListed(
  pass: ResolvePass,
  entry: PendingFactorLogEntry,
  exit: Exit
): Promise<boolean> {
  return (
    exit.reason === 'stopped-trading' &&
    (exit.silentSessions ?? 0) < LISTED_STOPPED_GRACE_SESSIONS &&
    (await pass.deps.listingStatus(entry.instrument, pass.options.signal)) === 'active'
  )
}

/** Scored at its last close rather than dropped: dropping the names that stopped trading is how a
 *  factor's record comes to look better than the board it picked from. Never while the market's
 *  own benchmark is also short, since then it is the feed that stopped, not the name. */
function stoppedExit(input: StoppedInput): Exit | undefined {
  const { bars, benchmarkBars, entry, window } = input
  const benchmarkEnd =
    benchmarkBars === undefined ? undefined : barAtWindowEnd(benchmarkBars, entry.day, window)
  const first = bars[0]
  const last = bars.findLast((bar) => bar.at >= entry.day)
  const silent =
    last === undefined ? 0 : (benchmarkBars ?? []).filter((bar) => bar.at > last.at).length

  if (
    benchmarkEnd === undefined ||
    silent < STOPPED_TRADING_GRACE_SESSIONS ||
    first === undefined ||
    first.at > entry.day ||
    last === undefined ||
    last.at >= benchmarkEnd.at
  ) {
    return undefined
  }

  return { at: last.at, close: last.close, reason: 'stopped-trading', silentSessions: silent }
}
