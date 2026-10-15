import type {
  SuggestionBatchItem,
  SuggestionBatchRequest,
} from '@/trading/features/suggestion/batch-types'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import type { MarketRegistry } from '@/trading/markets/types'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

type WatchlistScope = Extract<SuggestionBatchRequest['scope'], { readonly kind: 'watchlist' }>

/** First occurrence wins. An item with no market is keyed by its ticker alone: which market it
 *  resolves to is decided per run, so only an identical bare ticker is known to be the same name. */
export function uniqueItems(items: readonly SuggestionBatchItem[]): readonly SuggestionBatchItem[] {
  const seen = new Set<string>()

  return items.filter((item) => {
    const key =
      item.market === undefined
        ? item.ticker
        : buildInstrumentKey({ market: item.market, ticker: item.ticker })

    if (seen.has(key)) {
      return false
    }

    seen.add(key)

    return true
  })
}

export function watchlistItems(
  markets: MarketRegistry,
  scope: WatchlistScope,
  profile: UserProfile
): readonly SuggestionBatchItem[] {
  const excluded = new Set(profile.exclusions.map(buildInstrumentKey))
  const seen = new Set<string>()
  const items: SuggestionBatchItem[] = []

  for (const instrument of profile.watchlist) {
    const key = buildInstrumentKey(instrument)
    const eligible =
      !(excluded.has(key) || seen.has(key)) && markets.find(instrument.market) !== null

    if (!eligible) {
      continue
    }

    seen.add(key)
    items.push({
      locale: scope.locale,
      ticker: instrument.ticker,
      market: instrument.market,
    })

    if (items.length >= SURFACE_LIMITS.maximumSuggestionBatchItems) {
      return items
    }
  }

  return items
}
