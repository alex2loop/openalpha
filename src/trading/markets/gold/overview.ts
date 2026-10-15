import type { Caveat, CaveatCode } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { MarketRequest } from '@/trading/kernel/market/market-capability'
import type { Candle, MacroSnapshot, Quote } from '@/trading/kernel/market/market-data'
import type {
  MarketDataOverview,
  MarketDataOverviewRow,
  MarketRange,
} from '@/trading/kernel/market/market-overview'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { MarketManifest, TradingCalendar } from '@/trading/markets/types'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { dedupeProvenance, provenanceOf } from '@/trading/kernel/source/source-result'
import { resolveSettledDay } from '@/trading/markets/calendar'
import { WORLD_GOLD_REF } from '@/trading/markets/gold/api'
import { GOLD_MARKET_REF, GOLD_REGION, RANGE_SESSIONS } from '@/trading/markets/gold/policy'
import { type ReadingClock, toLiveReading } from '@/trading/markets/live-reading'
import { MACRO_COMPOSITE_REGION, mergeMacroValues } from '@/trading/markets/macro'
import { rangeFromCloses } from '@/trading/markets/overview'

interface GoldOverviewLoad {
  readonly deps: MarketDeps
  readonly manifest: MarketManifest
  readonly request: MarketRequest
}

/** World gold's own tape plus the macro forces that price it, and what speculators are positioned
 *  for. The domestic premium belongs to gold-vn's own block, which is the market that has one — a
 *  world overview reporting it would both duplicate that read and invert which market derives from
 *  which. Each piece is optional because each source may be unmeasured; absent means not published,
 *  never zero. */
export async function runGoldOverview(load: GoldOverviewLoad): Promise<MarketDataOverview> {
  const { deps, manifest, request } = load
  const { asOf, signal } = request
  // One clock read for the whole overview, and the day every settled number in it belongs to.
  const settledDay = resolveSettledDay(manifest.calendar, request.now)

  const [bars, quote, macro, positioning] = await Promise.all([
    readWorldBars(
      deps,
      { asOf, fromDay: manifest.calendar.addTradingDays(asOf, -RANGE_SESSIONS) },
      signal
    ),
    readWorldQuote(deps, signal),
    deps.macro.get(MACRO_COMPOSITE_REGION, asOf, signal),
    deps.sources.resolve({
      kind: 'positioning',
      context: { market: GOLD_MARKET_REF, region: GOLD_REGION },
      signal,
    }),
  ])
  const rows = worldRows(bars, quote, {
    calendar: manifest.calendar,
    clock: { settledDay, now: request.now },
  })
  const range = worldRange(bars, rows)
  const drivers = toDrivers(mergeMacroValues(macro).values)
  const contracts = positioning.kind === 'available' ? positioning.value : undefined

  return {
    market: GOLD_MARKET_REF,
    asOf: settledDay,
    currency: manifest.currency,
    priceCurrency: manifest.currency,
    icon: manifest.icon,
    rows,
    ...(range === undefined ? {} : { range }),
    ...(contracts === undefined ? {} : { positioning: contracts }),
    provenance: dedupeProvenance([
      ...provenanceOf(bars),
      ...provenanceOf(quote),
      ...macro.flatMap(provenanceOf),
      ...provenanceOf(positioning),
    ]),
    caveats: dedupeCaveats([
      ...bars.caveats,
      ...quote.caveats,
      ...macro.flatMap((read) => read.caveats),
      ...positioning.caveats,
      ...absenceCaveats([bars], range, 'market-data.insufficient-history'),
      ...absenceCaveats(macro, drivers, 'macro.inputs-missing'),
      ...absenceCaveats([positioning], contracts, 'market-data.no-coverage'),
    ]),
  }
}

/** The settled close and, beside it, where the metal trades now — the same pair every other price
 *  surface states. A failed quote leaves the close standing alone rather than the row absent.
 *
 *  The close is taken from the newest *final* session rather than the newest bar: a continuous
 *  market's series carries today's bar while today is still trading, and pricing the close off it
 *  would date the close to the session the live reading belongs to, leaving the pair with two
 *  readings of the same day. */
function worldRows(
  bars: SourceResult<readonly Candle[]>,
  quote: SourceResult<Quote>,
  session: { readonly calendar: TradingCalendar; readonly clock: ReadingClock }
): readonly MarketDataOverviewRow[] {
  const { calendar, clock } = session
  const settled =
    bars.kind === 'available'
      ? bars.value.findLast((candle) => candle.at <= clock.settledDay)
      : undefined

  if (settled === undefined) {
    return []
  }

  const live = toLiveReading(quote, calendar, clock)

  return [
    {
      instrument: WORLD_GOLD_REF,
      // A settled bar was observed at its own session's close, never at the refresh that stored it.
      quote: {
        instrument: WORLD_GOLD_REF,
        price: settled.close,
        observedAt: calendar.sessionCloseAt(settled.at),
      },
      closedOn: settled.at,
      ...(live === undefined ? {} : { live }),
    },
  ]
}

function readWorldQuote(deps: MarketDeps, signal: AbortSignal): Promise<SourceResult<Quote>> {
  return deps.sources.resolve({
    kind: 'quote',
    context: { market: GOLD_MARKET_REF, instrument: WORLD_GOLD_REF },
    signal,
  })
}

/** The world metal's own daily tape, from which the range is placed. */
function readWorldBars(
  deps: MarketDeps,
  window: { readonly asOf: TradingDay; readonly fromDay: TradingDay },
  signal: AbortSignal
): Promise<SourceResult<readonly Candle[]>> {
  return deps.sources.resolve({
    kind: 'bars',
    context: {
      market: GOLD_MARKET_REF,
      instrument: WORLD_GOLD_REF,
      fromDay: window.fromDay,
      toDay: window.asOf,
      limit: RANGE_SESSIONS,
    },
    signal,
  })
}

/** Measured from the live level where the metal is quoting one, so the swing reads against the price
 *  now rather than against the close it was drawn to. */
function worldRange(
  bars: SourceResult<readonly Candle[]>,
  rows: readonly MarketDataOverviewRow[]
): MarketRange | undefined {
  return bars.kind === 'available'
    ? rangeFromCloses(closes(bars.value), rows[0]?.live?.price)
    : undefined
}

function closes(bars: readonly Candle[]): readonly number[] {
  return bars.map((candle) => candle.close)
}

/** Absence is never silent: a failed read explains itself through its own caveats, but an unrouted
 *  one carries none, and a read that answered and still derived nothing needs its own reason. */
function absenceCaveats(
  reads: readonly SourceResult<unknown>[],
  derived: unknown,
  emptyDerivation: CaveatCode
): readonly Caveat[] {
  if (derived !== undefined) {
    return []
  }

  if (reads.some((read) => read.kind === 'available')) {
    return [{ code: emptyDerivation }]
  }

  return reads.some((read) => read.caveats.length > 0) ? [] : [{ code: 'market-data.no-coverage' }]
}

/** The cross-asset forces the asset-pricing literature treats as dominant: the real policy rate, the
 *  dollar, and the long yield. Read to decide whether this market's macro inputs resolved at all —
 *  the regime block states them once for the whole message, with the weights they were scored at. */
interface MarketDrivers {
  readonly realRatePct?: number
  readonly usdIndex?: number
  readonly us10yYieldPct?: number
}

function toDrivers(values: MacroSnapshot['values']): MarketDrivers | undefined {
  const drivers: MarketDrivers = {
    ...(values['us-real-rate'] === undefined ? {} : { realRatePct: values['us-real-rate'] }),
    ...(values['usd-index'] === undefined ? {} : { usdIndex: values['usd-index'] }),
    ...(values['us-10y-yield'] === undefined ? {} : { us10yYieldPct: values['us-10y-yield'] }),
  }

  return Object.keys(drivers).length === 0 ? undefined : drivers
}
