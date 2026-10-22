import type {
  BookDayChange,
  Holding,
  SectorValue,
  SegmentValue,
  ValuedBook,
  ValuedClose,
  ValuedPosition,
} from '@/trading/features/portfolio/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type {
  CurrencyCode,
  InstrumentKind,
  InstrumentRef,
  PortfolioSegment,
  TradingDay,
} from '@/trading/kernel/instrument'
import type { PreviousClose, QuoteView } from '@/trading/kernel/market/market-capability'
import type { FxQuote } from '@/trading/kernel/market/market-data'
import type { Book, PriceFreshness } from '@/trading/kernel/operator/book'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { utcDay } from '@/core/utils/time'
import {
  totalCostBase,
  totalFeesBase,
  unrealizedFxPnlBase,
} from '@/trading/features/portfolio/folds/book-totals'
import {
  heldCurrencyCash,
  type Rates,
  valueCurrencyCash,
} from '@/trading/features/portfolio/folds/currency-cash'
import { toHoldings } from '@/trading/features/portfolio/folds/holdings'
import { staleQuoteCaveats, staleRateCaveats } from '@/trading/features/portfolio/folds/staleness'
import { valuationCaveats } from '@/trading/features/portfolio/folds/valuation-caveats'
import { CASH_SEGMENT, ETF_KIND, exposureSectorOf, tradingDay } from '@/trading/kernel/instrument'
import { exitPriceOf } from '@/trading/markets/stored-quote'
import { changeAgainstClose } from '@/trading/sources/rows/normalization'

const VALUATION_CONCURRENCY = 5
/** `changePct` is percent-valued, as the provider publishes it. */
const PERCENT_PER_UNIT = 100

type PricedPosition = Extract<ValuedPosition, { kind: 'priced' }>

interface ValueBookOptions {
  readonly book: Book
  readonly asOf: TradingDay
  /** What a mark is old against — see `folds/staleness`. Never `asOf`, which is the calendar day. */
  readonly settledDay: TradingDay
  /** No `asOf`: no source prices a historical quote. */
  quoteFor(position: Holding, signal: AbortSignal): Promise<SourceResult<QuoteView>>
  convert(
    currency: CurrencyCode,
    asOf: TradingDay,
    signal: AbortSignal
  ): Promise<SourceResult<FxQuote>>
  segmentFor(instrument: InstrumentRef): PortfolioSegment | undefined
  sectorFor(instrument: InstrumentRef): string | undefined
  instrumentKindFor(instrument: InstrumentRef): InstrumentKind | undefined
  readonly signal: AbortSignal
}

/** Separate from `foldBook` so a missing price never alters ledger truth. */
export async function valueBook(options: ValueBookOptions): Promise<ValuedBook> {
  const rates = await resolveRates(options)
  const outcomes = await mapWithConcurrency(
    toHoldings(options.book.positions),
    VALUATION_CONCURRENCY,
    (holding) => valuePosition(holding, options, rates)
  )
  const valued = outcomes.map((outcome) => outcome.valued)
  const cash = valueCurrencyCash(options.book, rates, options.settledDay)
  const complete = valued.every((entry) => entry.kind === 'priced') && cash.priced

  const positionsValue = valued.reduce(
    (sum, entry) => sum + (entry.kind === 'priced' ? entry.valueBase : 0),
    0
  )
  // Absent, not a partial sum: a NAV over priced positions only reads authoritative and is wrong.
  const navBase = complete ? positionsValue + options.book.cashBase + cash.gainBase : undefined
  const investedBase = totalCostBase(options.book)
  const feesBase = totalFeesBase(options.book)
  const freshness = complete ? priceFreshness(valued) : undefined
  const fxPnlBase = complete ? unrealizedFxPnlBase(options.book, rates) : undefined

  return {
    book: options.book,
    positions: navBase === undefined ? valued : weighted(valued, navBase),
    // Closed-trade P/L needs no price, so it survives a partial valuation.
    realizedPnlBase: options.book.cashBase + investedBase - options.book.netDepositsBase,
    ...(navBase === undefined
      ? {}
      : {
          navBase,
          investedBase,
          feesBase,
          unrealizedPnlBase: positionsValue - investedBase,
          ...(fxPnlBase === undefined ? {} : { unrealizedFxPnlBase: fxPnlBase }),
          ...(cash.valued.length === 0 ? {} : { currencyCashGainBase: cash.gainBase }),
          ...dayChangeOf(valued, navBase),
        }),
    currencyCash: cash.valued,
    ...(freshness === undefined ? {} : { freshness }),
    segmentValues:
      navBase === undefined
        ? []
        : segmentValues(valued, options, {
            navBase,
            cashBase: options.book.cashBase + cash.gainBase,
          }),
    sectorValues: navBase === undefined ? [] : sectorValues(valued, options, navBase),
    caveats: valuationCaveats({ complete, outcomes, valued, cash, lookup: options }),
  }
}

/** Sums only legs publishing a day change, never treating the rest as flat. */
function dayChangeOf(
  valued: readonly ValuedPosition[],
  navBase: number
): { dayChange?: BookDayChange } {
  let amountBase = 0
  let oldest: TradingDay | undefined

  for (const entry of valued) {
    if (entry.kind !== 'priced' || entry.changePct === undefined) {
      continue
    }

    const ratio = 1 + entry.changePct / PERCENT_PER_UNIT

    if (ratio <= 0) {
      continue
    }

    amountBase += entry.valueBase - entry.valueBase / ratio
    oldest = oldest === undefined || entry.observed.day < oldest ? entry.observed.day : oldest
  }

  const opening = navBase - amountBase

  return oldest !== undefined && opening > 0
    ? { dayChange: { amountBase, fraction: amountBase / opening, at: oldest } }
    : {}
}

/** Weights stamp in one pass once NAV is known. */
function weighted(valued: readonly ValuedPosition[], navBase: number): readonly ValuedPosition[] {
  return valued.map((entry) =>
    entry.kind === 'priced'
      ? { ...entry, weightPctNav: weightOfNav(entry.valueBase, navBase) }
      : entry
  )
}

/** One claim for the whole book: a mixed book claims `close` with the weakest mark's day. */
function priceFreshness(valued: readonly ValuedPosition[]): PriceFreshness | undefined {
  const priced = valued.filter((entry): entry is PricedPosition => entry.kind === 'priced')

  if (priced.length === 0) {
    return undefined
  }

  const allLive = priced.every((entry) => entry.observed.kind === 'live')

  if (allLive) {
    const freshest = priced.reduce((a, b) =>
      b.observed.observedAt > a.observed.observedAt ? b : a
    )

    return {
      markKind: 'live',
      day: tradingDay(utcDay(freshest.observed.observedAt)),
      observedAt: freshest.observed.observedAt,
    }
  }

  const settled = priced.filter((entry) => entry.observed.kind !== 'live')
  const oldest = settled.reduce((a, b) => (b.observed.day < a.observed.day ? b : a))

  return { markKind: 'close', day: oldest.observed.day }
}

/** One conversion per distinct currency, not per holding. */
async function resolveRates(options: ValueBookOptions): Promise<Rates> {
  const currencies = [
    ...new Set([
      ...options.book.positions.map((position) => position.currency),
      ...heldCurrencyCash(options.book).map((cash) => cash.currency),
    ]),
  ]
  const entries = await mapWithConcurrency(
    currencies,
    VALUATION_CONCURRENCY,
    async (currency) =>
      [currency, await options.convert(currency, options.asOf, options.signal)] as const
  )

  return new Map(entries)
}

/** Converted at the same rate as the mark, never a second lookup. */
function valuedClose(
  previousClose: PreviousClose | undefined,
  priceBase: number | undefined
): { readonly previousClose?: ValuedClose } {
  if (previousClose === undefined || priceBase === undefined) {
    return {}
  }

  return {
    previousClose: {
      priceBase,
      price: previousClose.price,
      at: previousClose.at,
      ...(previousClose.changePct === undefined ? {} : { changePct: previousClose.changePct }),
    },
  }
}

/** Once today's bar is stored the mark IS that close; the settled row's own figure answers then. */
function markChangePct(
  view: QuoteView,
  converted: { readonly priceBase: number; readonly previousCloseBase: number | undefined }
): number | undefined {
  const { previousClose } = view

  if (previousClose !== undefined && view.observed.day === previousClose.at) {
    return previousClose.changePct
  }

  return changeAgainstClose(converted.priceBase, converted.previousCloseBase, view.quote.changePct)
}

/** `valued` identifies the holding; `sourceCaveats` says why, in the provider's words. */
interface ValuationOutcome {
  readonly valued: ValuedPosition
  readonly sourceCaveats: readonly Caveat[]
}

async function valuePosition(
  position: Holding,
  options: ValueBookOptions,
  rates: Rates
): Promise<ValuationOutcome> {
  const quote = await options.quoteFor(position, options.signal)

  if (quote.kind === 'unavailable') {
    return {
      valued: {
        kind: 'unpriced',
        position,
        caveat: {
          code: 'valuation.price-missing',
          detail: { ticker: position.instrument.ticker },
        },
      },
      sourceCaveats: quote.caveats,
    }
  }

  const rate = rates.get(position.currency)

  if (rate === undefined || rate.kind === 'unavailable') {
    return {
      valued: {
        kind: 'unpriced',
        position,
        caveat: { code: 'valuation.fx-missing', detail: { currency: position.currency } },
      },
      sourceCaveats: rate?.caveats ?? [],
    }
  }

  // A holding is worth what it sells for, which on a dealer board is the shop's buy price.
  const price = exitPriceOf(quote.value.quote)
  const dealer = quote.value.quote.board !== undefined
  const priceBase = price * rate.value.rate
  const { previousClose } = quote.value
  const previousCloseBase =
    previousClose === undefined ? undefined : previousClose.price * rate.value.rate
  const changePct = markChangePct(quote.value, { priceBase, previousCloseBase })

  return {
    valued: {
      kind: 'priced',
      position,
      priceBase,
      price,
      valueBase: priceBase * position.quantity,
      observed: quote.value.observed,
      ...(changePct === undefined ? {} : { changePct }),
      ...valuedClose(previousClose, previousCloseBase),
      ...(dealer ? { dealerBuy: true as const } : {}),
    },
    sourceCaveats: [
      ...quote.caveats,
      // Both arms: a degraded FX read moves NAV even when it did not fail outright.
      ...rate.caveats,
      ...staleQuoteCaveats(position, quote.value.observed, options.settledDay),
      ...(dealer ? [dealerBuyCaveat(position)] : []),
      ...staleRateCaveats(rate.value, options.settledDay),
    ],
  }
}

/** The row prints one price, and a reader comparing it with the shop's selling price would
 *  otherwise read the spread as a loss. */
function dealerBuyCaveat(position: Holding): Caveat {
  return { code: 'valuation.dealer-buy-price', detail: { ticker: position.instrument.ticker } }
}

/** Weights divide by NAV — cash included — never by invested value alone. */
function segmentValues(
  valued: readonly ValuedPosition[],
  options: ValueBookOptions,
  totals: { readonly navBase: number; readonly cashBase: number }
): readonly SegmentValue[] {
  const { navBase } = totals
  const segmentTotals = aggregateValues(valued, options.segmentFor, [
    [CASH_SEGMENT, totals.cashBase],
  ])
  const etfTotals = etfValues(valued, options)

  return [...segmentTotals].map(([segment, valueBase]) => {
    const etfBase = etfTotals.get(segment)

    return {
      segment,
      valueBase,
      weightPctNav: weightOfNav(valueBase, navBase),
      ...(etfBase === undefined ? {} : { etfPctNav: weightOfNav(etfBase, navBase) }),
    }
  })
}

/** Per-segment ETF value; absent for a segment with a kind-unknown holding, since a partial sum read
 *  as a total understates it. */
function etfValues(
  valued: readonly ValuedPosition[],
  options: ValueBookOptions
): ReadonlyMap<PortfolioSegment, number> {
  const totals = new Map<PortfolioSegment, number>()
  const unmeasured = new Set<PortfolioSegment>()

  for (const entry of valued) {
    const segment = options.segmentFor(entry.position.instrument)

    if (entry.kind !== 'priced' || segment === undefined) {
      continue
    }

    const kind = options.instrumentKindFor(entry.position.instrument)

    if (kind === undefined) {
      unmeasured.add(segment)
      continue
    }

    totals.set(segment, (totals.get(segment) ?? 0) + (kind === ETF_KIND ? entry.valueBase : 0))
  }

  for (const segment of unmeasured) {
    totals.delete(segment)
  }

  return totals
}

function sectorValues(
  valued: readonly ValuedPosition[],
  options: ValueBookOptions,
  navBase: number
): readonly SectorValue[] {
  const sectorOf = (instrument: InstrumentRef): string | undefined =>
    exposureSectorOf(options.instrumentKindFor(instrument), options.sectorFor(instrument))
  const totals = aggregateValues(valued, sectorOf, [])

  return [...totals].map(([sector, valueBase]) => ({
    sector,
    valueBase,
    weightPctNav: weightOfNav(valueBase, navBase),
  }))
}

/** Unpriced positions never contribute; an abstaining key is dropped, never bucketed. */
function aggregateValues<K>(
  valued: readonly ValuedPosition[],
  keyFor: (instrument: ValuedPosition['position']['instrument']) => K | undefined,
  seed: readonly (readonly [K, number])[]
): ReadonlyMap<K, number> {
  const totals = new Map<K, number>(seed)

  for (const entry of valued) {
    if (entry.kind !== 'priced') {
      continue
    }

    const key = keyFor(entry.position.instrument)

    if (key === undefined) {
      continue
    }

    totals.set(key, (totals.get(key) ?? 0) + entry.valueBase)
  }

  return totals
}

function weightOfNav(valueBase: number, navBase: number): number {
  return navBase === 0 ? 0 : valueBase / navBase
}
