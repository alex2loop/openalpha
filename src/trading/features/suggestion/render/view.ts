import type { Locale } from '@/core/types/locale'
import type { SuggestionDetail } from '@/trading/features/suggestion/render/debate'
import type { OperatorFigures } from '@/trading/features/suggestion/render/sections'
import type { CalibrationBucket } from '@/trading/features/suggestion/track-record/calibration'
import type {
  ResolvedActionableSuggestion,
  SuggestionRunResult,
} from '@/trading/features/suggestion/types'
import type { FactorAttribution } from '@/trading/kernel/factor'
import type { BoardLotPolicy, VenueRef } from '@/trading/kernel/instrument'
import type { TradeCost } from '@/trading/markets/cost'
import type { RenderContext } from '@/trading/render/format'
import type { QuoteConvention } from '@/trading/render/money'

export interface SuggestionTextInput {
  readonly locale: Locale
  readonly result: SuggestionRunResult
  readonly detail: SuggestionDetail
  /** Where the text is going: its clock, its line width, and whether it can hold a padded column. */
  readonly context: RenderContext
  /** How the suggestion's market prints a price, when the registry still lists it. */
  readonly quote?: QuoteConvention
  /** The same market's minimum reward-to-risk, for the plan line that names where the levels stop
   *  paying it. Absent where the market states no floor. */
  readonly minimumRiskReward?: number
  /** How this conviction band has actually resolved, when enough rows have. */
  readonly calibration?: CalibrationBucket
  /** The same question asked per factor. Rendered only at `full` detail. */
  readonly factorAttribution?: readonly FactorAttribution[]
  /** What the operator's broker charges in this market, when they have configured it. */
  readonly cost?: TradeCost
  /** Every venue that holds the suggestion's market, so the record hint can name where the fill
   *  will sit. */
  readonly recordVenues?: readonly VenueRef[]
  /** The latest resolved call on this name, for the line that says what the last one did. Absent
   *  on a first call, which has no record to stand on. */
  readonly previous?: ResolvedActionableSuggestion
  /** Share of the size entered on the first order, for the entry ladder. Absent when the profile
   *  could not be read; the ladder drops and the levels stand. */
  readonly entryTranchePct?: number
  /** The market's smallest accepted quantity, so the entry ladder states a first order the venue
   *  would actually fill. Absent where the market could not be resolved. */
  readonly boardLot?: BoardLotPolicy
  /** Whether the market raises a held name's stop as it runs. */
  readonly trailsStop?: boolean
  /** Whether a venue holding the market takes orders from this tree, so a raised stop names the
   *  command that moves one resting there. */
  readonly placesOrders?: boolean
  /** The focus a second opinion was made under, in words. Absent for the operator's own call, and
   *  where the focus is not known. */
  readonly focusLabel?: string
  readonly operatorFigures: OperatorFigures
}

/** Everything the render reads beside the run's own result. Exported so the command that gathers
 *  the market-derived half names one type rather than restating its fields. */
export type RenderView = Omit<SuggestionTextInput, 'result'>
