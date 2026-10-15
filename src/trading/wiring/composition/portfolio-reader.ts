import type { Locale } from '@/core/types/locale'
import type { PortfolioService } from '@/trading/features/portfolio/types'
import type { ProfileService } from '@/trading/features/profile/types'
import type { createSuggestionService } from '@/trading/features/suggestion/suggestion'
import type { RecordedFill } from '@/trading/features/suggestion/track-record/acted'
import type { TradingConfig } from '@/trading/kernel/config'
import type { CurrencyCode, TradingDay } from '@/trading/kernel/instrument'
import type { FxRates } from '@/trading/kernel/market/fx-rates'
import type { LedgerEntryId } from '@/trading/kernel/operator/book'
import type { MarketRegistry } from '@/trading/markets/types'
import type { VenueRegistry } from '@/trading/venues/types'
import { closedRoundTripsOf } from '@/trading/features/portfolio/folds/holdings'
import { SURFACE_LIMITS } from '@/trading/surface-limits'
import { minimumSizesByInstrument, reachableCashByMarket } from '@/trading/venues/holdings'

/** Named here rather than taken from composition's own dep bag: this seam reads four things, and
 *  stating which keeps the pipeline from reaching the rest through it. */
interface PortfolioReaderDeps {
  readonly markets: MarketRegistry
  readonly venues: VenueRegistry
  readonly config: Pick<TradingConfig, 'baseCurrency'>
  readonly defaultLocale: Locale
}

interface PortfolioReaderParts {
  readonly deps: PortfolioReaderDeps
  readonly fx: FxRates
  readonly profile: ProfileService
  readonly portfolio: PortfolioService
}

/** The pipeline's narrow read seam, satisfied by the portfolio service itself: one valuation owner
 *  means the book a debate reasons over is the same book the operator sees. */
export function createPortfolioReader(
  parts: PortfolioReaderParts
): Parameters<typeof createSuggestionService>[0]['portfolio'] {
  const { portfolio, profile: profiles, deps, fx } = parts
  const heldMarkets = deps.venues.heldMarkets()

  return {
    hasTradedSince: (instrument, since, signal) =>
      portfolio.hasTradedSince(instrument, since, signal),

    async read(options) {
      const at = { now: options.now, signal: options.signal }
      const profileOptions = { defaultLocale: deps.defaultLocale, signal: options.signal }
      const [profile, profileSaved, advised] = await Promise.all([
        profiles.get(profileOptions),
        profiles.isSaved(profileOptions),
        portfolio.rebalanceAbsolute({ ...at, segments: options.segments }),
      ])
      // One valuation per read: advice already priced the book its own numbers were measured
      // against, and asking for a second would quote every holding again at the same instant. The
      // fallback covers the arm that returns before valuing anything.
      const book = advised.book ?? (await portfolio.viewAbsolute(at))
      const [rateToBase, minimumSizes] = await Promise.all([
        loadRateToBase({ deps, fx, asOf: book.book.asOf, signal: options.signal }),
        minimumSizesByInstrument(deps.venues, book.book.positions, options.signal),
      ])

      return {
        profile,
        profileSaved,
        book,
        minimumSizes,
        closedRoundTrips: closedRoundTripsOf(book.book.sales, minimumSizes),
        advice: advised.advice,
        regimes: advised.regimes,
        rateToBase,
        reachableCashBase: reachableCashByMarket(deps.venues, book.book),
        heldMarkets,
      }
    },
  }
}

interface RateToBaseOptions {
  readonly deps: PortfolioReaderDeps
  readonly fx: FxRates
  readonly asOf: TradingDay
  readonly signal: AbortSignal
}

/** One rate per registered market currency, read with the book so every item in a batch converts
 *  against the same quotes. An unresolved currency is absent rather than defaulted. */
async function loadRateToBase(
  options: RateToBaseOptions
): Promise<ReadonlyMap<CurrencyCode, number>> {
  const { deps, fx, asOf, signal } = options
  const currencies = [...new Set(deps.markets.list().map((market) => market.manifest.currency))]
  const rates = await Promise.all(
    currencies.map(async (currency) => {
      const quote = await fx.convert({
        fromCurrency: currency,
        toCurrency: deps.config.baseCurrency,
        asOf,
        signal,
      })

      return quote.kind === 'available' ? ([currency, quote.value.rate] as const) : null
    })
  )

  return new Map(rates.filter((rate) => rate !== null))
}

/** The operator's buys and sells since a day, for the track record's acted-or-passed read. Every
 *  page of the window: the ledger store bounds its own size, so this ends. */
export async function listFillsSince(
  portfolio: Pick<PortfolioService, 'historyAbsolute'>,
  options: { readonly fromDay: TradingDay; readonly signal: AbortSignal }
): Promise<readonly RecordedFill[]> {
  const fills: RecordedFill[] = []
  let cursor: LedgerEntryId | undefined

  do {
    const page = await portfolio.historyAbsolute({
      range: { fromDay: options.fromDay },
      limit: SURFACE_LIMITS.maximumTrackRecordItems,
      signal: options.signal,
      ...(cursor === undefined ? {} : { cursor }),
    })

    for (const entry of page.items) {
      const txn = entry.transaction

      if (txn.kind === 'buy' || txn.kind === 'sell') {
        fills.push({
          instrument: txn.instrument,
          side: txn.kind,
          at: txn.at,
          unitPrice: txn.unitPrice,
        })
      }
    }

    cursor = page.nextCursor
  } while (cursor !== undefined)

  return fills
}
