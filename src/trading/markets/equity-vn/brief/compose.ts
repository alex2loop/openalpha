import type { BriefSectionKind } from '@/trading/kernel/operator/brief-section'
import type { MarketBrief } from '@/trading/kernel/operator/brief-story'
import type { BriefComposition, ProducingSectionKind } from '@/trading/markets/brief-compose'
import type { LoadContextOptions } from '@/trading/markets/brief-context'
import type { SectionBuilder } from '@/trading/markets/brief-sections'
import type { CrossSection } from '@/trading/markets/equity-vn/factors/factors'
import { composeBrief } from '@/trading/markets/brief-compose'
import { loadBriefContext } from '@/trading/markets/brief-context'
import { buildCrossAssetPulse } from '@/trading/markets/brief-cross-asset'
import { buildStalePositions, buildUnwatchedPositions } from '@/trading/markets/brief-holdings'
import { buildMacro, buildRegimeShift } from '@/trading/markets/brief-macro'
import {
  buildBookSummary,
  buildCost,
  buildCrossAssetSuggestions,
  buildDiscipline,
  buildDriftNudge,
  buildFiredAlerts,
  buildMonthlyScorecard,
  buildPositionExits,
  buildPositionsInLoss,
  buildResolvedSuggestions,
  buildSuggestions,
} from '@/trading/markets/brief-sections'
import { buildDisclosures } from '@/trading/markets/equity-vn/brief/disclosure-section'
import { buildEvents } from '@/trading/markets/equity-vn/brief/events'
import { buildIndexReview } from '@/trading/markets/equity-vn/brief/index-review-section'
import {
  buildBasis,
  buildBreadth,
  buildDepositRate,
  buildForeignDeskFlow,
  buildFx,
  buildMacroHeadlines,
  buildProprietaryFlow,
  buildSectorRotation,
  buildTape,
} from '@/trading/markets/equity-vn/brief/market-sections'
import { buildVnNextActions } from '@/trading/markets/equity-vn/brief/next-actions'
import { tryReadStories } from '@/trading/markets/equity-vn/brief/story-read'
import { buildTradeSides } from '@/trading/markets/equity-vn/brief/trade-sides-section'
import {
  buildScreenDelta,
  buildWatchlistDropped,
  buildWatchlistLeading,
} from '@/trading/markets/equity-vn/brief/watchlist-sections'
import { VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'

/** `BRIEF_SECTION_ORDER` drives both this record's exhaustiveness — a missing builder is a type
 *  error — and the render order. Adding a section means a tuple member, a builder, and two locale
 *  keys, and the locale gate enforces the last part. `recent` is the US filings block: VN reads
 *  its disclosures through `disclosures`. */
const SECTION_BUILDERS = Object.freeze({
  'book-summary': buildBookSummary,
  'resolved-suggestions': buildResolvedSuggestions,
  'fired-alerts': buildFiredAlerts,
  'position-exits': buildPositionExits,
  'unwatched-positions': buildUnwatchedPositions,
  'stale-positions': buildStalePositions,
  'positions-in-loss': buildPositionsInLoss,
  'trade-sides': buildTradeSides,
  'drift-nudge': buildDriftNudge,
  'monthly-scorecard': buildMonthlyScorecard,
  'regime-shift': buildRegimeShift,
  macro: buildMacro,
  'deposit-rate': buildDepositRate,
  'macro-headlines': buildMacroHeadlines,
  tape: buildTape,
  breadth: buildBreadth,
  basis: buildBasis,
  'sector-rotation': buildSectorRotation,
  'foreign-desk-flow': buildForeignDeskFlow,
  'proprietary-flow': buildProprietaryFlow,
  fx: buildFx,
  'watchlist-leading': buildWatchlistLeading,
  'watchlist-dropped': buildWatchlistDropped,
  'screen-delta': buildScreenDelta,
  'cross-asset-pulse': buildCrossAssetPulse,
  disclosures: buildDisclosures,
  'index-review': buildIndexReview,
  events: buildEvents,
  cost: buildCost,
  suggestions: buildSuggestions,
  'cross-asset-suggestions': buildCrossAssetSuggestions,
  discipline: buildDiscipline,
} as const satisfies Record<Exclude<ProducingSectionKind, 'recent'>, SectionBuilder<CrossSection>>)

/** Which kinds describe the VN market rather than the operator's own book or the region it sits in.
 *  The macro sections are deliberately absent: their drivers price every market in the brief, so
 *  they head the markets rather than sitting inside one. */
const VN_MARKET_KINDS: ReadonlySet<BriefSectionKind> = new Set([
  'tape',
  'breadth',
  'sector-rotation',
  'foreign-desk-flow',
  'proprietary-flow',
  'basis',
  'fx',
  'watchlist-leading',
  'watchlist-dropped',
  'screen-delta',
  'disclosures',
  'index-review',
  'events',
] as const satisfies readonly BriefSectionKind[])

const VN_COMPOSITION: BriefComposition<CrossSection> = Object.freeze({
  home: VN_MARKET_REF,
  builders: SECTION_BUILDERS,
  homeKinds: VN_MARKET_KINDS,
  buildNextActions: buildVnNextActions,
})

export async function buildVnBrief(
  options: LoadContextOptions<CrossSection>
): Promise<MarketBrief> {
  const context = await loadBriefContext(options)
  const { sections, homeOverview } = await composeBrief(context, VN_COMPOSITION)

  return { sections, stories: tryReadStories(context, sections, homeOverview) }
}
