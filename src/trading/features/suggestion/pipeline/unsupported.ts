import type { SuggestionRunResult } from '@/trading/features/suggestion/types'
import type { MarketResolution } from '@/trading/markets/types'

export function unsupported(
  resolution: Exclude<MarketResolution, { readonly kind: 'resolved' }>
): SuggestionRunResult {
  const base = { kind: 'unsupported', ticker: resolution.ticker } as const

  if (resolution.kind === 'ambiguous-market') {
    return { ...base, reason: 'ambiguous-market', candidateMarkets: resolution.candidates }
  }

  if (resolution.kind === 'market-not-registered') {
    return { ...base, reason: 'market-not-registered', market: resolution.market }
  }

  if (resolution.kind === 'unavailable') {
    return { ...base, reason: 'market-data-unavailable' }
  }

  return { ...base, reason: 'ticker-not-supported' }
}

export function outsideFocus(
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>
): SuggestionRunResult {
  return {
    kind: 'unsupported',
    ticker: resolution.instrument.ticker,
    reason: 'outside-focus',
    market: resolution.instrument.market,
  }
}
