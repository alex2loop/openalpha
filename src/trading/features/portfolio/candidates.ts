import type { BaseStatistics } from '@/trading/features/market-data/reads/statistics'
import type { MarketDataStore } from '@/trading/features/market-data/store/market-data'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { PortfolioCandidate } from '@/trading/features/portfolio/folds/candidate'
import type { ReduceVerdicts, ValuedBook } from '@/trading/features/portfolio/types'
import type { Caveat, EvidenceReduceReasonCode } from '@/trading/kernel/caveat'
import type { TradingConfig } from '@/trading/kernel/config'
import type { CurrencyCode, InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { FxRates } from '@/trading/kernel/market/fx-rates'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import type { VenueRegistry } from '@/trading/venues/types'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { buildInstrumentKey, dedupeInstruments } from '@/trading/kernel/instrument'
import { positionCapOf } from '@/trading/kernel/operator/profile'
import { isBelowMinimumSize } from '@/trading/kernel/venue/catalog'
import { listedFactsOf } from '@/trading/markets/registry'
import { minimumSizesByInstrument } from '@/trading/venues/holdings'

const CANDIDATE_CONCURRENCY = 5

interface CandidateDeps {
  readonly markets: MarketRegistry
  readonly marketDataStore: MarketDataStore
  readonly marketData: Pick<MarketDataService, 'quote'>
  readonly fx: FxRates
  readonly config: TradingConfig
}

interface CandidateOptions {
  readonly profile: UserProfile
  readonly valued: ValuedBook
  readonly asOf: TradingDay
  readonly now: number
  /** Keyed by `buildInstrumentKey`; absent means the market could not measure the window. */
  readonly statistics: ReadonlyMap<string, BaseStatistics>
  readonly signal: AbortSignal
  readonly instruments: readonly InstrumentRef[]
}

/** Advice sizes what the operator has chosen: what the book holds, plus the names it was given.
 *  Discovery belongs to `/screen` and `/suggest`, which present a name with its evidence before
 *  anyone weighs it — sizing an undiscussed name here would put it in a portfolio on a score alone.
 *  A segment whose names are all unnamed therefore resolves to cash, with the renormalization
 *  caveat saying so. */
export function candidateInstruments(
  valued: ValuedBook,
  watchlist: readonly InstrumentRef[]
): readonly InstrumentRef[] {
  const held = valued.positions.map((entry) => entry.position.instrument)

  return dedupeInstruments([...held, ...watchlist])
}

/** Candidate assembly has one owner. Markets publish factors and a manifest but no sizing method,
 *  so this is where a market score, a board lot, a price, and a liquidity estimate become one row
 *  the allocation formula can size. */
async function buildCandidates(
  deps: CandidateDeps,
  options: CandidateOptions
): Promise<readonly PortfolioCandidate[]> {
  const excluded = new Set(options.profile.exclusions.map(buildInstrumentKey))
  const held = new Set(
    options.valued.positions.map((entry) => buildInstrumentKey(entry.position.instrument))
  )
  // A row says a weight can be computed, not that the name may receive one — allocation decides
  // that and refuses every excluded name. A held exclusion still needs its row: advice is withheld
  // outright when a held position has none, so dropping it here takes the whole plan down over one
  // name the operator only declined to buy more of.
  const included = options.instruments.filter((instrument) => {
    const key = buildInstrumentKey(instrument)

    return !excluded.has(key) || held.has(key)
  })
  const rows = await mapWithConcurrency(included, CANDIDATE_CONCURRENCY, (instrument) =>
    toCandidate(deps, instrument, options)
  )

  return rows.filter((row): row is PortfolioCandidate => row !== null)
}

/** A name the registry cannot claim, or one with no priced observation, produces no candidate at
 *  all: sizing an unpriced position would invent a weight. */
async function toCandidate(
  deps: CandidateDeps,
  instrument: InstrumentRef,
  options: CandidateOptions
): Promise<PortfolioCandidate | null> {
  const market = deps.markets.find(instrument.market)

  if (market === null) {
    return null
  }

  const priced = await pricedValue(deps, { options, instrument, market })

  if (priced === null) {
    return null
  }

  const record = await deps.marketDataStore.findInstrument({ instrument, signal: options.signal })
  // A market that keeps no universe still knows what its names are.
  const listed =
    record === null
      ? await listedFactsOf(market, { ticker: instrument.ticker, signal: options.signal })
      : {
          ...(record.sector === undefined ? {} : { sector: record.sector }),
          ...(record.kind === undefined ? {} : { instrumentKind: record.kind }),
        }
  const factors = await market.factors({
    instrument,
    asOf: options.asOf,
    now: options.now,
    signal: options.signal,
  })
  const statistics = options.statistics.get(buildInstrumentKey(instrument))

  return {
    instrument,
    segment: market.manifest.segment,
    marketScore: factors.score,
    ...listed,
    unitPriceBase: priced.priceBase,
    unitPrice: priced.price,
    currency: priced.currency,
    boardLot: market.manifest.boardLot.size,
    ...(statistics?.averageDailyTurnoverBase === undefined
      ? {}
      : { averageDailyTurnoverBase: statistics.averageDailyTurnoverBase }),
    ...(statistics?.volatilityDaily === undefined
      ? {}
      : { volatilityDaily: statistics.volatilityDaily }),
    maximumPositionPctNav: positionCapOf(
      options.profile.caps[market.manifest.segment],
      record?.kind
    ),
    caveats: unmeasuredVolatilityCaveats(instrument, statistics?.volatilityDaily),
  }
}

/** Sizing divides by volatility, so a name whose own is unmeasured is sized against a default and
 *  weighed as if that were its risk. Absent is not a neutral reading: say so on the row. */
function unmeasuredVolatilityCaveats(
  instrument: InstrumentRef,
  volatilityDaily: number | undefined
): readonly Caveat[] {
  if (volatilityDaily !== undefined) {
    return []
  }

  return [{ code: 'portfolio.unmeasured-volatility', detail: { ticker: instrument.ticker } }]
}

/** Both readings of one mark: the base-currency figure sizing divides by, and the market's own
 *  quote, which is what an order line prints. Named for the pair `ValuedPosition` already carries. */
interface CandidateMark {
  readonly priceBase: number
  readonly price: number
  readonly currency: CurrencyCode
}

/** The book price is authoritative when it exists; otherwise the live quote, converted to the base
 *  currency at the booking day, prices a screened name the operator does not yet hold. A quote that
 *  did not resolve yields no candidate rather than an invented weight. */
interface MarkRequest {
  readonly options: CandidateOptions
  readonly instrument: InstrumentRef
  readonly market: Market
}

async function pricedValue(
  deps: CandidateDeps,
  request: MarkRequest
): Promise<CandidateMark | null> {
  const { options, instrument, market } = request
  const key = buildInstrumentKey(instrument)
  const entry = options.valued.positions.find(
    (position) => buildInstrumentKey(position.position.instrument) === key
  )

  if (entry?.kind === 'priced') {
    return { priceBase: entry.priceBase, price: entry.price, currency: market.manifest.currency }
  }

  const view = await deps.marketData.quote({
    ticker: instrument.ticker,
    market: instrument.market,
    now: options.now,
    signal: options.signal,
  })

  // A level has no currency, so there is nothing to convert and nothing to hold: a candidate the
  // book could price is always quoted in money.
  if (view.kind === 'unavailable' || view.value.currency === undefined) {
    return null
  }

  const rate = await deps.fx.convert({
    fromCurrency: view.value.currency,
    toCurrency: deps.config.baseCurrency,
    asOf: options.asOf,
    signal: options.signal,
  })

  return rate.kind === 'unavailable'
    ? null
    : {
        priceBase: view.value.quote.price * rate.value.rate,
        price: view.value.quote.price,
        currency: view.value.currency,
      }
}

interface AdviceInputDeps extends CandidateDeps {
  readonly reduceVerdicts: ReduceVerdicts
}

interface AdviceInputsOptions extends CandidateOptions {
  /** False when the book has no NAV to size against: no candidate row would be read, so none is
   *  built and no market is asked for a price. */
  readonly sizable: boolean
}

interface AdviceInputs {
  readonly candidates: readonly PortfolioCandidate[]
  readonly standingReduces: ReadonlyMap<string, EvidenceReduceReasonCode>
}

/** What a rebalance plan is built from beyond the book itself. Neither read depends on the other,
 *  so they run together rather than serially behind the screen. */
export async function loadAdviceInputs(
  deps: AdviceInputDeps,
  options: AdviceInputsOptions
): Promise<AdviceInputs> {
  const { valued, signal } = options
  const [candidates, standingReduces] = await Promise.all([
    options.sizable
      ? buildCandidates(deps, options)
      : Promise.resolve<readonly PortfolioCandidate[]>([]),
    deps.reduceVerdicts.standing({ instruments: heldInstruments(valued), signal }),
  ])

  return { candidates, standingReduces }
}

function heldInstruments(valued: ValuedBook): readonly InstrumentRef[] {
  return valued.positions.map((entry) => entry.position.instrument)
}

/** Residue below the venue's smallest order is not a holding to size. Its value stays in NAV. */
export async function withoutResidue(
  venues: VenueRegistry,
  valued: ValuedBook,
  signal: AbortSignal
): Promise<ValuedBook> {
  const minimumSizes = await minimumSizesByInstrument(venues, valued.book.positions, signal)
  const positions = valued.positions.filter(
    (entry) =>
      !isBelowMinimumSize(
        entry.position.quantity,
        minimumSizes.get(buildInstrumentKey(entry.position.instrument))
      )
  )

  return { ...valued, positions }
}
