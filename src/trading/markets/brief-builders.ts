import type { ProducingSectionKind } from '@/trading/markets/brief-compose'
import type { SectionBuilder } from '@/trading/markets/brief-sections'
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

type SharedSectionKind = Extract<
  ProducingSectionKind,
  | 'book-summary'
  | 'resolved-suggestions'
  | 'fired-alerts'
  | 'position-exits'
  | 'unwatched-positions'
  | 'stale-positions'
  | 'positions-in-loss'
  | 'drift-nudge'
  | 'monthly-scorecard'
  | 'regime-shift'
  | 'macro'
  | 'cross-asset-pulse'
  | 'cost'
  | 'suggestions'
  | 'cross-asset-suggestions'
  | 'discipline'
>

/** The sections every home market's brief runs: the operator's own book, the home region's regime,
 *  the calls and the tail. A home market adds its own tape, flow and calendar sections beside them. */
export const SHARED_SECTION_BUILDERS = Object.freeze({
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
  cost: buildCost,
  suggestions: buildSuggestions,
  'cross-asset-suggestions': buildCrossAssetSuggestions,
  discipline: buildDiscipline,
} as const satisfies Record<SharedSectionKind, SectionBuilder>)
