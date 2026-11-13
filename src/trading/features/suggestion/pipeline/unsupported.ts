import type { SuggestionRunResult } from '@/trading/features/suggestion/types'
import type { CaveatCode } from '@/trading/kernel/caveat'
import type { MarketResolution } from '@/trading/markets/types'
import { isLevelKind } from '@/trading/kernel/instrument'

const TOKENIZED_EQUITY: CaveatCode = 'market.tokenized-equity'

type UnsupportedResult = Extract<SuggestionRunResult, { readonly kind: 'unsupported' }>
type ResolvedMarket = Extract<MarketResolution, { readonly kind: 'resolved' }>

/** Why each level kind is refused: the name resolves, but it is a reading and no asset. */
const LEVEL_KIND_REASONS = {
  index: 'index-untradeable',
  future: 'future-untradeable',
} as const satisfies Record<'index' | 'future', UnsupportedResult['reason']>

export function unsupported(
  resolution: Exclude<MarketResolution, { readonly kind: 'resolved' }>
): UnsupportedResult {
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

  const tokenized = resolution.caveats.some((caveat) => caveat.code === TOKENIZED_EQUITY)

  return { ...base, reason: tokenized ? 'tokenized-equity' : 'ticker-not-supported' }
}

// A market with no stored universe has never been refreshed, and /refresh is the step that helps
// even when another market's detector failed beside it: after the refresh, a failure left over
// reads as the provider's.
function unavailableReasonOf(
  resolution: Extract<MarketResolution, { readonly kind: 'unavailable' }>
): UnsupportedResult['reason'] {
  return resolution.caveats.some((caveat) => caveat.code === 'market-data.universe-empty')
    ? 'market-data-not-loaded'
    : 'market-data-unavailable'
}

export function outsideFocus(resolution: ResolvedMarket): SuggestionRunResult {
  return {
    kind: 'unsupported',
    ticker: resolution.instrument.ticker,
    reason: 'outside-focus',
    market: resolution.instrument.market,
  }
}

/** An index or a futures contract resolves, but nothing buys it through a spot venue, so there is
 *  no call to make on it. Absent for every kind that can be held. */
export function levelKindRefusal(resolution: ResolvedMarket): UnsupportedResult | undefined {
  const { instrumentKind } = resolution

  if (!isLevelKind(instrumentKind)) {
    return undefined
  }

  return {
    kind: 'unsupported',
    ticker: resolution.instrument.ticker,
    reason: LEVEL_KIND_REASONS[instrumentKind],
    market: resolution.instrument.market,
  }
}
