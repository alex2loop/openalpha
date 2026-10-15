// Read-through day cache for bars adapters whose series are raw, UTC-keyed, and continuous: a day
// before today is settled and immutable, so it is fetched once and never refetched. Today's
// still-forming bar is never served — every consumer of this kind reads bars as settled evidence
// and takes its live price from the `quote` kind instead. An adjusted series (equity-vn) restates
// backwards and must never pass through here. Continuity is load-bearing — coverage is checked over
// calendar days, so a market with weekends never hits.
import type { LruMap } from '@/core/utils/collections'
import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { Candle } from '@/trading/kernel/market/market-data'
import type {
  Source,
  SourceContext,
  SourceProvenance,
  SourceResult,
} from '@/trading/kernel/source/source-result'
import { lruMap } from '@/core/utils/collections'
import { MS_PER_DAY, MS_PER_SECOND } from '@/core/utils/time'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { available, dedupeProvenance } from '@/trading/kernel/source/source-result'
import { dayFromEpochSeconds, utcDayStartEpochMs } from '@/trading/sources/rows/normalization'

/** One screen population times its evidence window (25 × 201), the gold fallback route, and
 *  headroom for watchlist churn — below it, a full screen evicts the oldest days of its own
 *  windows, and the prefix a later read starts from is whatever survived. */
const SETTLED_BARS_CACHE_MAXIMUM_ENTRIES = 8_000

interface CacheEntry {
  /** Absent where the provider published nothing for this day, which is still an answer. */
  readonly candle?: Candle
  readonly fetchedAt: number
  /** What the source said about the instrument when it answered this day, so a hit repeats what
   *  the miss that filled it reported. */
  readonly caveats: readonly Caveat[]
}

interface SettledWindow {
  /** Market-qualified: one ticker can name a different instrument on each market a source serves. */
  readonly instrumentKey: string
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
}

interface SettledBarsDeps {
  readonly source: Source<'bars'>
  readonly cache: LruMap<string, CacheEntry>
}

export function withSettledBars(source: Source<'bars'>): Source<'bars'> {
  const deps: SettledBarsDeps = { source, cache: lruMap(SETTLED_BARS_CACHE_MAXIMUM_ENTRIES) }

  return { ...source, fetch: (context, signal) => fetchBars(deps, context, signal) }
}

async function fetchBars(
  deps: SettledBarsDeps,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceResult<readonly Candle[]>> {
  const window = cacheableWindow(context)

  if (window === null) {
    return deps.source.fetch(context, signal)
  }

  const now = Date.now()
  const today = toUtcDay(now)
  const cached = cachedPrefix(deps.cache, window, today)

  if (cached.missingFrom === undefined) {
    return available(
      recentCandles(candlesOf(cached.entries), context.limit),
      cachedProvenance(deps.source.id, cached.entries),
      cachedCaveats(cached.entries)
    )
  }

  const result = await deps.source.fetch({ ...context, fromDay: cached.missingFrom }, signal)

  if (result.kind !== 'available') {
    return result
  }

  const fetched = store(deps, window, {
    candles: result.value,
    fetchedAt: result.provenance[0]?.fetchedAt ?? now,
    caveats: result.caveats,
    from: cached.missingFrom,
    today,
  })

  return available(
    recentCandles([...candlesOf(cached.entries), ...fetched], context.limit),
    dedupeProvenance([...cachedProvenance(deps.source.id, cached.entries), ...result.provenance]),
    dedupeCaveats([...cachedCaveats(cached.entries), ...result.caveats])
  )
}

interface StoredWindow {
  readonly candles: readonly Candle[]
  readonly fetchedAt: number
  readonly caveats: readonly Caveat[]
  /** The first day this fetch was asked for, which is where the cached prefix ended. */
  readonly from: TradingDay
  readonly today: TradingDay
}

/** Today's bar is dropped before anything reads it: it still moves, so keeping it would make one
 *  window score differently minute to minute and date the evidence to a session nobody has closed.
 *  Days before `from` go with it — a source free to ignore the narrowed range would otherwise
 *  duplicate what the prefix already holds. */
function store(
  deps: SettledBarsDeps,
  window: SettledWindow,
  fetched: StoredWindow
): readonly Candle[] {
  const settled = fetched.candles.filter(
    (candle) => candle.at >= fetched.from && candle.at < fetched.today
  )

  for (const day of unpublishedLead(fetched.from, settled)) {
    deps.cache.set(dayKey(window, day), {
      fetchedAt: fetched.fetchedAt,
      caveats: fetched.caveats,
    })
  }

  for (const candle of settled) {
    deps.cache.set(dayKey(window, candle.at), {
      candle,
      fetchedAt: fetched.fetchedAt,
      caveats: fetched.caveats,
    })
  }

  return settled
}

/** The days a provider answered for by publishing nothing: a listing has no bars before its first
 *  one, and leaving them uncached makes every later read refetch the whole window for any name
 *  younger than it. Only the leading run — a gap further in could be a truncated response, and
 *  recording that as absent would quietly shorten every lookback that follows. */
function unpublishedLead(from: TradingDay, settled: readonly Candle[]): readonly TradingDay[] {
  const earliest = settled.reduce<TradingDay | undefined>(
    (found, candle) => (found === undefined || candle.at < found ? candle.at : found),
    undefined
  )

  if (earliest === undefined) {
    return []
  }

  const days: TradingDay[] = []

  for (let day = from; day < earliest; day = addUtcDays(day, 1)) {
    days.push(day)
  }

  return days
}

interface CachedPrefix {
  readonly entries: readonly CacheEntry[]
  /** The first settled day the cache could not answer; absent when it held the whole window. */
  readonly missingFrom?: TradingDay
}

/** The longest run of settled days the cache holds from the start of the window. A miss ends the
 *  run rather than discarding it: one newly settled day would otherwise refetch the two hundred
 *  before it, which is what every name on a board costs each time the UTC day rolls over. A day
 *  still missing here was never fetched, or a provider truncated its answer there; only the days
 *  from it onward are refetched, so a served series never has a hole in it. */
function cachedPrefix(
  cache: LruMap<string, CacheEntry>,
  window: SettledWindow,
  today: TradingDay
): CachedPrefix {
  const settledTo = window.toDay < today ? window.toDay : addUtcDays(today, -1)

  if (window.fromDay > settledTo) {
    return { entries: [], missingFrom: window.fromDay }
  }

  const entries: CacheEntry[] = []

  for (let day = window.fromDay; day <= settledTo; day = addUtcDays(day, 1)) {
    const entry = cache.get(dayKey(window, day))

    if (entry === undefined) {
      return { entries, missingFrom: day }
    }

    entries.push(entry)
  }

  return { entries }
}

function cachedProvenance(
  id: Source<'bars'>['id'],
  entries: readonly CacheEntry[]
): readonly SourceProvenance[] {
  return dedupeProvenance(
    entries.map((entry) => ({
      sourceId: id,
      fetchedAt: entry.fetchedAt,
      freshness: 'cached' as const,
    }))
  )
}

function cachedCaveats(entries: readonly CacheEntry[]): readonly Caveat[] {
  return dedupeCaveats(entries.flatMap((entry) => entry.caveats))
}

/** Caching needs a named day window; a limit-only request passes through untouched. */
function cacheableWindow(context: SourceContext): SettledWindow | null {
  const { instrument, fromDay, toDay } = context

  if (instrument === undefined || fromDay === undefined || toDay === undefined || fromDay > toDay) {
    return null
  }

  return { instrumentKey: `${instrument.market}|${instrument.ticker}`, fromDay, toDay }
}

function toUtcDay(now: number): TradingDay {
  return dayFromEpochSeconds(now / MS_PER_SECOND, 'UTC')
}

function addUtcDays(day: TradingDay, offset: number): TradingDay {
  return toUtcDay(utcDayStartEpochMs(day) + offset * MS_PER_DAY)
}

function dayKey(window: SettledWindow, day: TradingDay): string {
  return `${window.instrumentKey}|${day}`
}

function candlesOf(entries: readonly CacheEntry[]): readonly Candle[] {
  return entries.flatMap((entry) => entry.candle ?? [])
}

function recentCandles(candles: readonly Candle[], limit: number | undefined): readonly Candle[] {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return candles
  }

  return candles.slice(-Math.floor(limit))
}
