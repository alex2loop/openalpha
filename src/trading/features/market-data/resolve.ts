import type { Caveat } from '@/trading/kernel/caveat'
import type {
  InstrumentKind,
  InstrumentMatch,
  InstrumentRef,
  InstrumentSearchRequest,
  MarketRef,
  Region,
  Ticker,
  TickerRequest,
  TradingDay,
} from '@/trading/kernel/instrument'
import type { SourceUnavailable } from '@/trading/kernel/source/source-result'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import { ValidationError } from '@/core/errors'
import { buildInstrumentKey, dedupeInstruments, ticker } from '@/trading/kernel/instrument'
import { unavailable } from '@/trading/kernel/source/source-result'
import { resolveSettledDay, shiftCalendarDay } from '@/trading/markets/calendar'

/** Roughly forty years of sessions: long enough that no legitimate range hits it. */
const MAXIMUM_RANGE_SESSIONS = 10_000
const DAYS_PER_WEEK = 7
/** The longest run of calendar days an exchange stays shut. VN's Tet cluster is the binding case
 *  at nine days; the margin only widens a search window, so over-stating it costs nothing. */
export const MAXIMUM_CLOSURE_DAYS = 21

type InstrumentResolution =
  | {
      readonly kind: 'resolved'
      readonly market: Market
      readonly instrument: InstrumentRef
      readonly instrumentKind?: InstrumentKind
    }
  | { readonly kind: 'unresolved'; readonly result: SourceUnavailable }

interface ResolveInstrumentOptions {
  readonly ticker: Ticker
  readonly market?: MarketRef
  readonly signal: AbortSignal
}

export type InstrumentsResolution =
  | {
      readonly kind: 'resolved'
      readonly instruments: readonly InstrumentRef[]
      /** Per instrument key, the kind the stored record files it under. A renderer cannot reach
       *  the store, so resolution carries one map for the whole batch. Absent kinds stay absent. */
      readonly instrumentKinds: ReadonlyMap<string, InstrumentKind>
    }
  | { readonly kind: 'unresolved'; readonly caveats: readonly Caveat[] }

/** All-or-nothing: one unmatched name fails the request, because a partially applied list is a
 *  plan nobody asked for. Every failed name's caveats come back together, so the operator learns
 *  which name was unknown and which was ambiguous in one reply. */
export async function resolveInstruments(
  markets: MarketRegistry,
  options: { readonly tickers: readonly TickerRequest[]; readonly signal: AbortSignal }
): Promise<InstrumentsResolution> {
  const resolutions = await Promise.all(
    options.tickers.map((request) =>
      resolveInstrument(markets, { ...request, signal: options.signal })
    )
  )
  const instruments = resolutions.flatMap((entry) =>
    entry.kind === 'resolved' ? [entry.instrument] : []
  )

  if (instruments.length < options.tickers.length) {
    return {
      kind: 'unresolved',
      caveats: resolutions.flatMap((entry) =>
        entry.kind === 'unresolved' ? entry.result.caveats : []
      ),
    }
  }

  return {
    kind: 'resolved',
    instruments: dedupeInstruments(instruments),
    instrumentKinds: kindsOf(resolutions),
  }
}

/** Display only: a name whose kind never resolved prints bare, so absent kinds stay absent here. */
function kindsOf(
  resolutions: readonly InstrumentResolution[]
): ReadonlyMap<string, InstrumentKind> {
  const kinds = new Map<string, InstrumentKind>()

  for (const entry of resolutions) {
    if (entry.kind === 'resolved' && entry.instrumentKind !== undefined) {
      kinds.set(buildInstrumentKey(entry.instrument), entry.instrumentKind)
    }
  }

  return kinds
}

/** Surfaces hand this layer an unqualified ticker because only the registry can qualify one. An
 *  unsupported or ambiguous name becomes the typed unavailable arm carrying the registry's own
 *  caveats — never a fallback market. */
export async function resolveInstrument(
  markets: MarketRegistry,
  options: ResolveInstrumentOptions
): Promise<InstrumentResolution> {
  const resolution = await markets.resolve({
    ticker: options.ticker,
    ...(options.market === undefined ? {} : { market: options.market }),
    signal: options.signal,
  })

  if (resolution.kind === 'resolved') {
    return {
      kind: 'resolved',
      market: resolution.market,
      instrument: resolution.instrument,
      ...(resolution.instrumentKind === undefined
        ? {}
        : { instrumentKind: resolution.instrumentKind }),
    }
  }

  return { kind: 'unresolved', result: unavailable('unsupported', [], resolution.caveats) }
}

/** A symbol typed in full, resolved the way a suggestion resolves it: the only way to find a coin or
 *  a fund in a market that keeps no searchable catalog. */
async function exactMatches(
  markets: MarketRegistry,
  query: string,
  signal: AbortSignal
): Promise<readonly InstrumentMatch[]> {
  let candidate: ReturnType<typeof ticker>

  try {
    candidate = ticker(query)
  } catch {
    return []
  }

  const resolution = await markets.resolve({ ticker: candidate, signal })

  if (resolution.kind !== 'resolved') {
    return []
  }

  return [
    {
      instrument: resolution.instrument,
      ...(resolution.instrumentKind === undefined
        ? {}
        : { instrumentKind: resolution.instrumentKind }),
    },
  ]
}

/** An exact symbol first, then every catalog match, each instrument once. */
export async function searchInstruments(
  markets: MarketRegistry,
  options: InstrumentSearchRequest
): Promise<readonly InstrumentMatch[]> {
  const query = options.query.trim()

  if (query === '') {
    return []
  }

  const [exact, ...catalogs] = await Promise.all([
    exactMatches(markets, query, options.signal),
    ...markets.list().map((market) => market.search?.({ ...options, query }) ?? []),
  ])
  const byKey = new Map<string, InstrumentMatch>()

  // The exact symbol keeps its lead; the catalog's row for the same name fills in what it lacks.
  for (const match of [...exact, ...catalogs.flat()]) {
    const key = buildInstrumentKey(match.instrument)

    byKey.set(key, { ...match, ...byKey.get(key) })
  }

  return [...byKey.values()].slice(0, options.limit)
}

/** A market that is registered but publishes no such capability is `unsupported`, not a failure. */
export function unsupportedCapability(caveats: readonly Caveat[] = []): SourceUnavailable {
  return unavailable('unsupported', [], caveats)
}

/** The only instant-to-day conversion: the market that owns the calendar performs it, so no
 *  surface invents a UTC or local day rule. It takes an instant and nothing else — a caller that
 *  could hand it a day could date a suggestion to a day the choice was not made on. */
export function resolveDay(market: Market, now: number): TradingDay {
  return market.manifest.calendar.dayAt(now)
}

/** Today, for a book or a view that spans markets: the market that owns the region dates it.
 *  A UTC day would lag the operator's own by seven hours in VN, hiding a trade recorded before the
 *  UTC date rolls over. Without an owner there is no defensible way to turn an instant into a day. */
export function resolveRegionDay(markets: MarketRegistry, region: Region, now: number): TradingDay {
  return regionOwnerOf(markets, region).manifest.calendar.dayAt(now)
}

/** The newest session the region has actually closed, which is what a reading is old against. Not
 *  `resolveRegionDay`: that answers what today is called, and today is a Saturday or a holiday often
 *  enough that judging a close by it reports every price on the book as stale for the weekend. */
export function resolveRegionSettledDay(
  markets: MarketRegistry,
  region: Region,
  now: number
): TradingDay {
  return resolveSettledDay(regionOwnerOf(markets, region).manifest.calendar, now)
}

/** Without an owner there is no defensible way to turn an instant into a day for the region. */
function regionOwnerOf(markets: MarketRegistry, region: Region): Market {
  const owner = markets.regionOwner(region)

  if (owner === null) {
    throw new ValidationError(`no registered market covers region ${region}`)
  }

  return owner
}

/** Days the market is *expected* to trade, projected from the weekend rule. Use this only to size
 *  a fetch: it cannot know which past days the exchange was shut, so it over-counts across a
 *  holiday. Over-counting a fetch is harmless — a source returns the bars it has, and the consumer
 *  measures what came back rather than trusting this number. The cap bounds a malformed range and
 *  a calendar that fails to advance; it is a backstop, not a policy. */
export function calendarSessionsBetween(
  market: Market,
  fromDay: TradingDay,
  toDay: TradingDay
): number {
  if (fromDay > toDay) {
    return 0
  }

  const calendar = market.manifest.calendar
  let sessions = calendar.isTradingDay(fromDay) ? 1 : 0
  let cursor = fromDay

  for (let step = 0; step < MAXIMUM_RANGE_SESSIONS; step += 1) {
    const next = calendar.addTradingDays(cursor, 1)

    if (next <= cursor || next > toDay) {
      return sessions
    }

    cursor = next
    sessions += 1
  }

  return sessions
}

/** Consumer-side seam over the market-data store: the workflow needs observed sessions, not a
 *  bar reader, and naming only that keeps the store swappable behind one method. */
export interface SessionReader {
  listSessionDays(options: {
    readonly market: MarketRef
    readonly fromDay: TradingDay
    readonly toDay: TradingDay
    readonly signal: AbortSignal
  }): Promise<readonly TradingDay[]>
}

/** The day `count` observed sessions after `fromDay`, exclusive of it. Falls back to the weekend
 *  projection once observed history runs out, which is the normal case for a settlement date in
 *  the future — no bar exists yet for a day that has not traded. */
export async function advanceObservedSessions(
  sessions: SessionReader,
  market: Market,
  advance: { readonly fromDay: TradingDay; readonly count: number; readonly signal: AbortSignal }
): Promise<TradingDay> {
  if (advance.count <= 0) {
    return advance.fromDay
  }

  // The search window cannot be built from `addTradingDays`: that is the weekday arithmetic this
  // function exists to correct, and across a closure it would end before the first real session.
  // Weekends plus the longest exchange shutdown, so `count` sessions always fall inside it.
  const horizon = shiftCalendarDay(
    advance.fromDay,
    advance.count * DAYS_PER_WEEK + MAXIMUM_CLOSURE_DAYS
  )
  const days = await sessions.listSessionDays({
    market: market.manifest.id,
    fromDay: advance.fromDay,
    toDay: horizon,
    signal: advance.signal,
  })
  // `fromDay` itself is session zero when it traded, so the settled day is `count` entries past it.
  const observed = days.filter((day) => day > advance.fromDay)
  const landed = observed[advance.count - 1]

  if (landed !== undefined) {
    return landed
  }

  const last = observed[observed.length - 1] ?? advance.fromDay

  return market.manifest.calendar.addTradingDays(last, advance.count - observed.length)
}
