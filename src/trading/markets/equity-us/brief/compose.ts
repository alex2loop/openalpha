import type { BriefSectionKind, BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { MarketBrief, StoryRead } from '@/trading/kernel/operator/brief-story'
import type { BriefComposition, SectionBuilders } from '@/trading/markets/brief-compose'
import type { BriefContext, BriefHome, LoadContextOptions } from '@/trading/markets/brief-context'
import type { UsBoard } from '@/trading/markets/equity-us/board'
import { MACRO_FORMULA_VERSION } from '@/trading/kernel/market/macro-series'
import { composeBrief } from '@/trading/markets/brief-compose'
import { loadBriefContext } from '@/trading/markets/brief-context'
import { buildCrossAssetPulse } from '@/trading/markets/brief-cross-asset'
import { buildStalePositions, buildUnwatchedPositions } from '@/trading/markets/brief-holdings'
import { buildMacro, buildRegimeShift } from '@/trading/markets/brief-macro'
import { buildNextActions } from '@/trading/markets/brief-next-actions'
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
import { readUsEvents } from '@/trading/markets/equity-us/brief/events-read'
import { buildRecent } from '@/trading/markets/equity-us/brief/recent-section'
import {
  US_EQUITY_MACRO_DRIVERS,
  US_LIQUIDITY_SESSIONS,
  US_MARKET_REF,
  US_MARKET_REGION,
} from '@/trading/markets/equity-us/policy'
import { medianTurnover } from '@/trading/markets/turnover'

/** What the US brief reports: the operator's own book, the US regime that scales what it buys, the
 *  filings of the names in it, the suggestions, and the tail. The market's prices, range and headlines come from its overview and
 *  news reads, the way every non-home market's do, so a kind without a builder here is not run. */
const SECTION_BUILDERS: SectionBuilders<UsBoard> = Object.freeze({
  'book-summary': buildBookSummary,
  'resolved-suggestions': buildResolvedSuggestions,
  'fired-alerts': buildFiredAlerts,
  'position-exits': buildPositionExits,
  'unwatched-positions': buildUnwatchedPositions,
  'stale-positions': buildStalePositions,
  'positions-in-loss': buildPositionsInLoss,
  'drift-nudge': buildDriftNudge,
  'monthly-scorecard': buildMonthlyScorecard,
  'regime-shift': buildRegimeShift,
  macro: buildMacro,
  'cross-asset-pulse': buildCrossAssetPulse,
  recent: buildRecent,
  cost: buildCost,
  suggestions: buildSuggestions,
  'cross-asset-suggestions': buildCrossAssetSuggestions,
  discipline: buildDiscipline,
})

/** No market story: the story reads VN's tape, and a US one would need its own detectors. */
const NO_STORY: StoryRead = Object.freeze({ kind: 'unread' })

const US_MARKET_KINDS: ReadonlySet<BriefSectionKind> = new Set(['recent'])

export const US_BRIEF_HOME: BriefHome<UsBoard> = Object.freeze({
  market: US_MARKET_REF,
  region: US_MARKET_REGION,
  macroDrivers: US_EQUITY_MACRO_DRIVERS,
  macroFormulaVersion: MACRO_FORMULA_VERSION,
  namesOf: (board: UsBoard) =>
    board.names.map((name) => {
      const turnover = medianTurnover(name.bars, US_LIQUIDITY_SESSIONS)

      return { instrument: name.record.instrument, ...(turnover === undefined ? {} : { turnover }) }
    }),
  // The US board ranks names by capitalisation, not by sector.
  sectorsOf: () => [],
  readEvents: readUsEvents,
})

function buildUsNextActions(
  context: BriefContext<UsBoard>,
  sections: readonly BriefSectionResult[]
): Promise<BriefSectionResult> {
  return buildNextActions(context, sections)
}

const US_COMPOSITION: BriefComposition<UsBoard> = Object.freeze({
  home: US_MARKET_REF,
  builders: SECTION_BUILDERS,
  homeKinds: US_MARKET_KINDS,
  buildNextActions: buildUsNextActions,
})

export async function buildUsBrief(options: LoadContextOptions<UsBoard>): Promise<MarketBrief> {
  const context = await loadBriefContext(options)
  const { sections } = await composeBrief(context, US_COMPOSITION)

  return { sections, stories: NO_STORY }
}
