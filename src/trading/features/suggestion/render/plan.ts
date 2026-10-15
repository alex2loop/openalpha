import type { Locale } from '@/core/types/locale'
import type { MessageKey } from '@/i18n'
import type {
  ActionableStoredSuggestion,
  PullbackStat,
  StoredSuggestion,
} from '@/trading/features/suggestion/types'
import type { BoardLotPolicy } from '@/trading/kernel/instrument'
import type { QuotedIn } from '@/trading/render/money'
import { formatDay, t } from '@/i18n'
import { bankedShareOf } from '@/trading/features/suggestion/exit-plan/first-exit'
import { OUTCOME_WINDOW_DAYS } from '@/trading/features/suggestion/pipeline/outcome-window'
import { armsExit } from '@/trading/features/suggestion/types'
import { floorToLot } from '@/trading/kernel/instrument'
import { voidPrice } from '@/trading/markets/levels'
import { spreadPct } from '@/trading/markets/overview'
import {
  formatFraction,
  formatQuantity,
  formatSignedFraction,
  formatSignedPercent,
  formatWholeFraction,
  SECTION_ICONS,
} from '@/trading/render/format'
import { INDENT, renderSectionTitle } from '@/trading/render/layout'
import { formatPriceIn } from '@/trading/render/money'

/** Derived, never stored: the plan restates the levels the suggestion already carries, so a
 *  re-render can never disagree with them. */
export function renderPlanLines(
  locale: Locale,
  suggestion: StoredSuggestion,
  options: PlanLinesOptions = {}
): readonly string[] {
  if (suggestion.action !== 'buy') {
    return []
  }

  return [
    renderSectionTitle(SECTION_ICONS.plan, t(locale, 'trading.render.suggestion.planTitle')),
    ...renderEntryLines(locale, suggestion, options),
    ...renderTakeProfitLines(locale, suggestion, options),
    ...renderStopBasisLines(locale, suggestion, options),
    `${INDENT[1]}${renderReviewLine(locale, suggestion)}`,
    ...renderPullbackLines(locale, suggestion.pullback),
  ]
}

export interface PlanLinesOptions {
  readonly quote?: QuotedIn
  /** The market's minimum reward-to-risk, for the price past which the levels stop paying it.
   *  Absent where the market states no floor, and the line drops with it. */
  readonly minimumRiskReward?: number
  /** Share of the size entered on the first order. Absent when the profile could not be read,
   *  which drops the entry ladder. */
  readonly entryTranchePct?: number
  /** The market's smallest accepted quantity. Absent where the market could not be resolved, which
   *  drops the entry ladder rather than stating a first order in units the venue would refuse. */
  readonly boardLot?: BoardLotPolicy
  /** Whether the market raises a held name's stop as it runs. Absent reads as no. */
  readonly trailsStop?: boolean
}

/** A resting entry is one order at one price, so neither a chase ceiling nor a second tranche at the
 *  entry has anything to say about it. */
function renderEntryLines(
  locale: Locale,
  suggestion: ActionableStoredSuggestion,
  options: PlanLinesOptions
): readonly string[] {
  const resting = suggestion.restingEntry

  if (resting === undefined) {
    return [
      ...renderChaseLines(locale, suggestion, options),
      ...renderEntryLadder(locale, suggestion, options),
    ]
  }

  const day = formatDay(locale, resting.until)

  return [
    `${INDENT[1]}${t(locale, 'trading.render.suggestion.planResting', {
      run: formatFraction(locale, resting.run),
      sessions: resting.runSessions,
      price: formatPriceIn(locale, suggestion.entry, options.quote),
      day,
    })}`,
    `${INDENT[1]}${t(locale, 'trading.render.suggestion.planRestingVenue', { day })}`,
  ]
}

/** Named only where the market states a floor, and only above entry: a level at or below the price
 *  the plan just asked for describes levels that never paid that floor, which is the void caveat's
 *  to report rather than a line telling the operator not to take the trade they were handed. */
function renderChaseLines(
  locale: Locale,
  suggestion: ActionableStoredSuggestion,
  options: PlanLinesOptions
): readonly string[] {
  const { minimumRiskReward, quote } = options

  if (minimumRiskReward === undefined) {
    return []
  }

  const chase = voidPrice(suggestion, minimumRiskReward)

  if (chase <= suggestion.entry) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.suggestion.planChase', {
      price: formatPriceIn(locale, chase, quote),
      pct: formatSignedFraction(locale, (chase - suggestion.entry) / suggestion.entry),
    })}`,
  ]
}

/** Where the first profit is taken, in the words of how the rest is handled: a trailing plan banks
 *  a tranche and lets the rest ride its stop, a plan with no trail is complete at its target, and a
 *  fund is graded there and rebalanced rather than sold. */
function renderTakeProfitLines(
  locale: Locale,
  suggestion: ActionableStoredSuggestion,
  options: PlanLinesOptions
): readonly string[] {
  const { entry, takeProfit, target } = suggestion
  const banked = bankedShareOf(suggestion, options.trailsStop === true)
  const params = {
    tranche: formatWholeFraction(locale, banked),
    price: formatPriceIn(locale, takeProfit, options.quote),
    pct: formatSignedFraction(locale, (takeProfit - entry) / entry),
    target: formatPriceIn(locale, target, options.quote),
    targetPct: formatSignedFraction(locale, (target - entry) / entry),
  }
  return [`${INDENT[1]}${t(locale, takeProfitKeyOf(suggestion, banked), params)}`]
}

function takeProfitKeyOf(suggestion: ActionableStoredSuggestion, banked: number): MessageKey {
  if (!armsExit(suggestion)) {
    return 'trading.render.suggestion.planTakeProfitFund'
  }

  if (banked >= 1) {
    return 'trading.render.suggestion.planTakeProfit'
  }

  return suggestion.takeProfit < suggestion.target
    ? 'trading.render.suggestion.planTakeProfitLadder'
    : 'trading.render.suggestion.planTakeProfitTrail'
}

/** A broker rests a stop order; a gold shop does not, so a dealer board's levels are read on the
 *  price the shop pays back and watched for the operator. A fund arms nothing. */
function renderStopBasisLines(
  locale: Locale,
  suggestion: ActionableStoredSuggestion,
  options: PlanLinesOptions
): readonly string[] {
  if (!armsExit(suggestion)) {
    return []
  }

  if (suggestion.quote?.board === undefined) {
    return [`${INDENT[1]}${t(locale, 'trading.render.suggestion.stopBasis')}`]
  }

  return [
    ...renderDealerBoardLines(locale, suggestion, options.quote),
    `${INDENT[1]}${t(locale, 'trading.render.suggestion.stopBasisDealer')}`,
  ]
}

/** Which side of a dealer board the levels sit on, and what the spread between the sides costs. */
export function renderDealerBoardLines(
  locale: Locale,
  suggestion: StoredSuggestion,
  quote: Partial<QuotedIn> | undefined
): readonly string[] {
  const board = suggestion.quote?.board
  const spread = board === undefined ? undefined : spreadPct(board.buyPrice, board.sellPrice)

  if (board === undefined || spread === undefined) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.suggestion.levelsOnDealerBuy', {
      buy: formatPriceIn(locale, board.buyPrice, quote),
      spread: formatFraction(locale, spread),
    })}`,
  ]
}

/** The day the call is graded. A swing trade is closed on it; a long holding and a fund are
 *  re-checked on it, because selling a business or an index on a date alone is not a thesis. */
function renderReviewLine(locale: Locale, suggestion: ActionableStoredSuggestion): string {
  const params = { days: OUTCOME_WINDOW_DAYS[suggestion.horizon] }

  if (!armsExit(suggestion)) {
    return t(locale, 'trading.render.suggestion.planReviewFund', params)
  }

  return suggestion.horizon === 'long'
    ? t(locale, 'trading.render.suggestion.planReview', params)
    : t(locale, 'trading.render.suggestion.planTimeStop', params)
}

/** The first order in units the venue accepts, never as a bare share of the size: the sizer floors
 *  to a whole lot, so a share of it lands mid-lot and an operator following the line literally
 *  sends an odd lot to a market that prices those apart. A size already down to one lot cannot be
 *  staged at all, and says nothing rather than advice it cannot carry out. */
function renderEntryLadder(
  locale: Locale,
  suggestion: ActionableStoredSuggestion,
  options: PlanLinesOptions
): readonly string[] {
  const { entryTranchePct, boardLot, quote } = options
  const units = suggestion.units

  if (entryTranchePct === undefined || boardLot === undefined || units === undefined) {
    return []
  }

  const first = floorToLot(units * entryTranchePct, boardLot.size)

  if (first <= 0 || first >= units) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.suggestion.entryLadder', {
      shares: formatQuantity(locale, first),
      ticker: suggestion.instrument.ticker,
      entry: formatPriceIn(locale, suggestion.entry, quote),
    })}`,
  ]
}

/** The edge is priced at the discount the first line names, and charges every window that never
 *  reached it as holding nothing — so no fill rate is printed: at a name's own median depth it is
 *  ~50% whatever the name. The last line stays load-bearing: a bar reaching a price is the ceiling
 *  on whether an order resting there traded, which no daily series can settle. */
function renderPullbackLines(
  locale: Locale,
  pullback: PullbackStat | undefined
): readonly string[] {
  if (pullback === undefined) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.suggestion.planPullback', {
      sessions: pullback.waitSessions,
      best: formatSignedPercent(locale, pullback.medianBestPct),
    })}`,
    `${INDENT[1]}${t(locale, 'trading.render.suggestion.planPullbackEdge', {
      edge: formatSignedPercent(locale, pullback.waitEdgePct),
      hold: pullback.holdSessions,
    })}`,
    `${INDENT[1]}${t(locale, 'trading.render.suggestion.planPullbackFill')}`,
  ]
}
