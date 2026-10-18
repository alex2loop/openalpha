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
    return { ...base, reason: unavailableReasonOf(resolution) }
  }

  return { ...base, reason: 'ticker-not-supported' }
}

// A market with no stored universe has never been refreshed, and /refresh is the step that helps
// even when another market's detector failed beside it: after the refresh, a failure left over
// reads as the provider's.
function unavailableReasonOf(
  resolution: Extract<MarketResolution, { readonly kind: 'unavailable' }>
): Extract<SuggestionRunResult, { readonly kind: 'unsupported' }>['reason'] {
  return resolution.caveats.some((caveat) => caveat.code === 'market-data.universe-empty')
    ? 'market-data-not-loaded'
    : 'market-data-unavailable'
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
