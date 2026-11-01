import type { LedgerStore } from '@/trading/features/ledger/store/ledger'
import type { MarketDataStore } from '@/trading/features/market-data/store/market-data'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { ResidueSizing } from '@/trading/features/portfolio/folds/holdings'
import type {
  RelativePortfolioView,
  RelativePositionView,
} from '@/trading/features/portfolio/relative-view'
import type { Holding, ValuedBook, ValuedPosition } from '@/trading/features/portfolio/types'
import type { TradingConfig } from '@/trading/kernel/config'
import type {
  InstrumentKind,
  InstrumentRef,
  PortfolioSegment,
  TradingDay,
} from '@/trading/kernel/instrument'
import type { FxRates } from '@/trading/kernel/market/fx-rates'
import type { Book, ClosedRoundTrip } from '@/trading/kernel/operator/book'
import type { MarketRegistry } from '@/trading/markets/types'
import { foldBook } from '@/trading/features/ledger/book'
import { orderLedger } from '@/trading/features/ledger/validate'
import {
  closedRoundTripsOf,
  recentClosedRoundTrips,
  withoutResidue,
} from '@/trading/features/portfolio/folds/holdings'
import { valueBook } from '@/trading/features/portfolio/folds/valuation'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { listedFactsOf } from '@/trading/markets/registry'

const PERCENT_PER_UNIT = 100

export interface PortfolioViewDeps {
  readonly ledger: LedgerStore
  readonly markets: MarketRegistry
  readonly marketDataStore: MarketDataStore
  readonly marketData: MarketDataService
  readonly fx: FxRates
  readonly config: TradingConfig
}

interface ViewOptions {
  readonly asOf: TradingDay
  /** The one clock read for the whole valuation. Quoting per position from `Date.now()` would let
   *  holdings at the top of a book and the bottom be priced from different instants. */
  readonly now: number
  readonly signal: AbortSignal
}

interface ValuedViewOptions extends ViewOptions {
  /** The last session the region closed — what a mark is old against. Separate from `asOf`, which
   *  is the calendar day and is a non-trading one every weekend. */
  readonly settledDay: TradingDay
  readonly minimumSizes?: ResidueSizing['minimumSizes']
}

/** Positions are always a fold of the ledger, never a stored balance: there is no second copy that
 *  can disagree with the rows. */
export async function loadBook(deps: PortfolioViewDeps, options: ViewOptions): Promise<Book> {
  const entries = await deps.ledger.listAll(options.signal)

  return foldBook(orderLedger(entries), options.asOf, deps.config.baseCurrency)
}

interface InstrumentFacts {
  readonly sector?: string
  readonly instrumentKind?: InstrumentKind
}

export interface ValuedContext {
  readonly valued: ValuedBook
  readonly instruments: ReadonlyMap<string, InstrumentFacts>
}

export async function loadValuedContext(
  deps: PortfolioViewDeps,
  options: ValuedViewOptions
): Promise<ValuedContext> {
  const book = await loadBook(deps, options)
  // One read per held instrument, taken together before valuation starts: a book is tens of names
  // against a universe of thousands, and nothing below re-reads it.
  const instruments = await loadInstrumentFacts(deps, book, options.signal)
  const valued = await valueBook({
    book,
    asOf: options.asOf,
    settledDay: options.settledDay,
    quoteFor: (position, signal) =>
      deps.marketData.quote({
        ticker: position.instrument.ticker,
        market: position.instrument.market,
        now: options.now,
        withPreviousClose: true,
        signal,
      }),
    convert: (currency, asOf, signal) =>
      deps.fx.convert({
        fromCurrency: currency,
        toCurrency: deps.config.baseCurrency,
        asOf,
        signal,
      }),
    segmentFor: (instrument) => segmentFor(deps.markets, instrument),
    sectorFor: (instrument) => instruments.get(buildInstrumentKey(instrument))?.sector,
    instrumentKindFor: (instrument) =>
      instruments.get(buildInstrumentKey(instrument))?.instrumentKind,
    ...(options.minimumSizes === undefined ? {} : { minimumSizes: options.minimumSizes }),
    signal: options.signal,
  })

  return { valued, instruments }
}

/** Sector and kind are market-data, not manifest data, so both come from the stored universe rather
 *  than the registry, and from the market's own detector where it keeps no universe. An instrument
 *  neither answers for has neither — which every cap reads as uncheckable, never as compliant. */
async function loadInstrumentFacts(
  deps: PortfolioViewDeps,
  book: Book,
  signal: AbortSignal
): Promise<ReadonlyMap<string, InstrumentFacts>> {
  const facts = await storedFacts(deps, book, signal)

  for (const position of book.positions) {
    const key = buildInstrumentKey(position.instrument)
    const market = deps.markets.find(position.instrument.market)

    if (!facts.has(key) && market !== null) {
      facts.set(key, await listedFactsOf(market, { ticker: position.instrument.ticker, signal }))
    }
  }

  return facts
}

async function storedFacts(
  deps: PortfolioViewDeps,
  book: Book,
  signal: AbortSignal
): Promise<Map<string, InstrumentFacts>> {
  const held = new Map(
    book.positions.map((position) => [buildInstrumentKey(position.instrument), position.instrument])
  )
  const records = await Promise.all(
    [...held.values()].map((instrument) =>
      deps.marketDataStore.findInstrument({ instrument, signal })
    )
  )
  const facts = new Map<string, InstrumentFacts>()

  for (const record of records) {
    if (record !== null) {
      facts.set(buildInstrumentKey(record.instrument), {
        ...(record.sector === undefined ? {} : { sector: record.sector }),
        ...(record.kind === undefined ? {} : { instrumentKind: record.kind }),
      })
    }
  }

  return facts
}

/** An unregistered instrument yields `undefined`, which every consumer reads as "a cap that cannot
 *  be checked" rather than as a pass. */
export function segmentFor(
  markets: MarketRegistry,
  instrument: InstrumentRef
): PortfolioSegment | undefined {
  return markets.find(instrument.market)?.manifest.segment
}

/** The agent-facing projection: weights only, since the type has no field for an amount, a cost or
 *  a return, and no renderer can widen it back into one. Every `*PctNav` share is a fraction;
 *  `settledPctQuantity` is percent-valued, as its name says. */
export function toRelativeView(
  valued: ValuedBook,
  minimumSizes: ReadonlyMap<string, number>
): RelativePortfolioView {
  const nav = valued.navBase
  // Absent rather than zero when NAV is unknown: a weight of 0% and "we cannot compute a weight"
  // are different facts, and only the second is honest here.
  const share = (valueBase: number): { weightPctNav?: number } =>
    nav === undefined || nav <= 0 ? {} : { weightPctNav: valueBase / nav }

  return {
    asOf: valued.book.asOf,
    positions: withoutResidue(valued, minimumSizes).positions.map((entry) =>
      toRelativePosition(entry, nav)
    ),
    segmentWeights: valued.segmentValues.map((segment) => ({
      segment: segment.segment,
      ...share(segment.valueBase),
    })),
    sectorWeights: valued.sectorValues.map((sector) => ({
      sector: sector.sector,
      ...share(sector.valueBase),
    })),
    closedPositions: closedPositionsOf(closedRoundTripsOf(valued.book.sales, minimumSizes)),
    caveats: valued.caveats,
  }
}

/** Rebuilt field by field, so an amount added to the round trip later stays out of this view. */
function closedPositionsOf(
  trips: readonly ClosedRoundTrip[]
): RelativePortfolioView['closedPositions'] {
  return recentClosedRoundTrips(trips).map((trip) => ({
    instrument: trip.instrument,
    closedAt: trip.closedAt,
    result: trip.realizedFraction < 0 ? 'loss' : 'gain',
  }))
}

function toRelativePosition(entry: ValuedPosition, nav: number | undefined): RelativePositionView {
  if (entry.kind === 'unpriced') {
    return {
      instrument: entry.position.instrument,
      settledPctQuantity: settledPct(entry.position),
      caveats: [entry.caveat],
    }
  }

  const weighted = nav !== undefined && nav > 0

  return {
    instrument: entry.position.instrument,
    ...(weighted ? { weightPctNav: entry.valueBase / nav } : {}),
    settledPctQuantity: settledPct(entry.position),
    markedOn: entry.observed.day,
    caveats: [],
  }
}

/** A percentage, not a count: the count is a quantity, and quantities are absolute data. */
function settledPct(position: Holding): number {
  return position.quantity === 0
    ? PERCENT_PER_UNIT
    : (position.settledQuantity / position.quantity) * PERCENT_PER_UNIT
}

/** One map for the whole book, keyed the way the rows look it up. The mark is in the quoting
 *  market's own currency, because that is the currency a plan's stop is stored in; `priceBase` here
 *  measured a USDT stop against a đồng mark and reported every crypto holding as a full stop-width
 *  clear of its stop. An unpriced holding contributes none. */
export function marksByInstrument(book: ValuedBook): ReadonlyMap<string, number> {
  return new Map(
    book.positions.flatMap((valued) =>
      valued.kind === 'priced'
        ? [[buildInstrumentKey(valued.position.instrument), valued.price] as const]
        : []
    )
  )
}
