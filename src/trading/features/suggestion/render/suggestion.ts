import type { Locale } from '@/core/types/locale'
import type { PlanLinesOptions } from '@/trading/features/suggestion/render/plan'
import type { RenderView, SuggestionTextInput } from '@/trading/features/suggestion/render/view'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { QuotedIn } from '@/trading/render/money'
import { formatDay, t } from '@/i18n'
import {
  renderUnsupportedClaims,
  unsupportedSet,
} from '@/trading/features/suggestion/render/claims'
import { renderDebateLines } from '@/trading/features/suggestion/render/debate'
import { renderFactorLines } from '@/trading/features/suggestion/render/factors'
import {
  holdReasonLines,
  levelQuote,
  verdictOf,
} from '@/trading/features/suggestion/render/headline'
import { renderHeldExit } from '@/trading/features/suggestion/render/held-exit'
import { renderHistoryLines } from '@/trading/features/suggestion/render/history'
import { renderLevelLines } from '@/trading/features/suggestion/render/hold-levels'
import { renderOrderNotes } from '@/trading/features/suggestion/render/order'
import { renderPlanLines } from '@/trading/features/suggestion/render/plan'
import { renderRecordHint } from '@/trading/features/suggestion/render/record-hint'
import { shownCall } from '@/trading/features/suggestion/render/second-opinion'
import {
  renderBoardScaleLines,
  renderHeldLine,
  renderIndexTierLine,
  renderInvalidatorLines,
  renderQuoteLine,
  renderReduceReasonLines,
  renderScaledSizeLine,
  renderSourceLines,
  renderThesisBreakLines,
} from '@/trading/features/suggestion/render/sections'
import {
  filteredCaveats,
  inconclusiveBanner,
  isInconclusive,
  renderStampLine,
  renderUnsupportedReason,
} from '@/trading/features/suggestion/render/verdict'
import { framedDirectionOf } from '@/trading/features/suggestion/types'
import { isBookCall } from '@/trading/kernel/operator/focus'
import { renderCaveatLines } from '@/trading/render/caveat'
import {
  formatCount,
  formatFraction,
  renderDeclaredValue,
  SECTION_ICONS,
} from '@/trading/render/format'
import { INDENT, joinSections, renderSectionTitle } from '@/trading/render/layout'

/** A reuse spends nothing, and the recycle mark is what says so before the sentence does. */
const REUSED_MARK = '♻️'

export function renderSuggestionText(input: SuggestionTextInput): string {
  const { result, ...view } = input
  const { locale } = view

  switch (result.kind) {
    case 'completed':
      // A reuse spends nothing, so no footer follows it to tell it apart from a fresh run.
      return joinSections([
        result.reused ? [`${REUSED_MARK} ${t(locale, 'trading.render.suggestion.reused')}`] : [],
        ...renderStored(view, result.suggestion),
      ])
    case 'cooldown':
      return joinSections([
        [
          t(locale, 'trading.render.suggestion.cooldown', {
            day: formatDay(locale, result.eligibleAfter),
          }),
        ],
        ...renderStored(view, result.previous),
      ])
    case 'unsupported':
      return [
        renderUnsupportedReason(locale, result),
        ...(result.candidateMarkets === undefined
          ? []
          : [
              t(locale, 'trading.render.suggestion.candidateMarkets', {
                markets: result.candidateMarkets.join(', '),
              }),
            ]),
      ].join('\n')
    case 'error':
      return t(locale, 'trading.render.suggestion.error', { ticker: result.ticker })
    default: {
      const exhaustive: never = result
      return exhaustive
    }
  }
}

/** The session the numbers describe, only where it is not the day in the header: a post-close
 *  run on a board is dated by the session it closed, and repeating it is a second stamp to drift. */
function evidenceLine(locale: Locale, suggestion: StoredSuggestion): readonly string[] {
  const through = suggestion.evidenceThrough

  if (through === undefined || through === suggestion.at) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.suggestion.evidenceThrough', {
      day: formatDay(locale, through),
    })}`,
  ]
}

/** A focus call opens by saying so: it is not the call that drives the operator's book. */
function secondOpinionLine(view: RenderView, suggestion: StoredSuggestion): readonly string[] {
  if (isBookCall(suggestion)) {
    return []
  }

  const focus = view.focusLabel ?? t(view.locale, 'trading.focus.another')

  return [
    `${INDENT[1]}${t(view.locale, 'trading.focus.secondOpinion', {
      focus,
      ticker: suggestion.instrument.ticker,
    })}`,
  ]
}

function renderStored(view: RenderView, call: StoredSuggestion): readonly (readonly string[])[] {
  const { locale } = view
  const suggestion = shownCall(call)
  // A debate that failed to complete leaves the run without a conclusion: the header may not claim
  // a hold verdict the body cannot back, and the failure reads at the top, not as a tail caveat.
  const inconclusive = isInconclusive(suggestion)
  const verdict = verdictOf(view, suggestion)
  const holdReasons = holdReasonLines(locale, suggestion, inconclusive)
  const quote = levelQuote(view, suggestion)
  const facts = renderFacts(view, suggestion)

  return [
    [
      renderSectionTitle(SECTION_ICONS.suggestion, verdict),
      ...facts.head,
      ...renderReduceReasonLines(locale, suggestion),
      ...renderHeldExit({
        locale,
        suggestion,
        ...(quote === undefined ? {} : { quote }),
        ...(view.cost === undefined ? {} : { cost: view.cost }),
        placesOrders: view.placesOrders === true,
        operatorFigures: view.operatorFigures,
      }),
      ...renderScaledSizeLine(locale, suggestion),
      ...renderThesisBreakLines(locale, suggestion),
      ...(inconclusive ? inconclusiveBanner(view.locale, suggestion) : []),
      ...holdReasons,
      ...(inconclusive
        ? []
        : renderLevelLines({
            locale,
            suggestion,
            trailsStop: view.trailsStop === true,
            operatorFigures: view.operatorFigures,
            ...(view.boardLot === undefined ? {} : { boardLot: view.boardLot }),
            ...(quote === undefined ? {} : { quoted: quote }),
          })),
      ...renderCalibrationLine(view, suggestion),
    ],
    ...renderBodyBlocks(view, suggestion, facts.context),
  ]
}

/** The lines that frame the verdict. `head` sits under it: whose call it is, earlier calls on the
 *  name, the quote and the holding. `context` closes the report: the evidence day, the profile
 *  stamp, the board scale and the index tier say how to read the numbers rather than what they say,
 *  so the decision reads before its fine print. */
export function renderFacts(
  view: RenderView,
  suggestion: StoredSuggestion
): { readonly head: readonly string[]; readonly context: readonly string[] } {
  const { locale } = view

  return {
    head: [
      ...secondOpinionLine(view, suggestion),
      ...renderHistoryLines(locale, view.previous),
      ...renderQuoteLine(locale, suggestion, view.quote?.display),
      ...renderHeldLine(locale, suggestion, view.operatorFigures),
    ],
    context: [
      ...evidenceLine(locale, suggestion),
      ...renderStampLine(locale, suggestion),
      ...renderBoardScaleLines(locale, suggestion, levelQuote(view, suggestion)),
      ...renderIndexTierLine(locale, suggestion),
    ],
  }
}

/** The plan, its notes and the detail, then the fine print the verdict was read under. The
 *  degraded-debate caveat is absent when hoisted: it already sits under the price as the banner,
 *  and printing it twice reads as two failures. */
function renderBodyBlocks(
  view: RenderView,
  suggestion: StoredSuggestion,
  context: readonly string[]
): readonly (readonly string[])[] {
  const { locale } = view
  const quote = levelQuote(view, suggestion)

  return [
    renderPlanLines(locale, suggestion, planOptions(view, quote)),
    renderOrderNotes({
      locale,
      suggestion,
      ...(quote === undefined ? {} : { quote }),
      ...(view.cost === undefined ? {} : { cost: view.cost }),
      trailsStop: view.trailsStop === true,
    }),
    ...renderDetailBlocks(view, suggestion),
    context.map((line) => line.trimStart()),
    [t(locale, 'trading.render.suggestion.disclaimer')],
    renderRecordHint({
      locale,
      suggestion,
      venues: view.recordVenues ?? [],
      ...(view.quote === undefined ? {} : { quote: view.quote }),
    }),
  ]
}

/** Why the call reads as it does, after the plan: the thesis and what would break it first, then
 *  the factors, the debate, the sources and the caveats behind them. */
export function renderDetailBlocks(
  view: RenderView,
  suggestion: StoredSuggestion
): readonly (readonly string[])[] {
  const { locale } = view
  const quote = levelQuote(view, suggestion)

  return [
    renderThesisLines(locale, suggestion),
    renderInvalidatorLines(locale, suggestion),
    renderFactorLines({
      locale,
      suggestion,
      detail: view.detail,
      context: view.context,
      ...(quote === undefined ? {} : { quote }),
      ...(view.factorAttribution === undefined ? {} : { attribution: view.factorAttribution }),
    }),
    suggestion.debate === undefined
      ? []
      : renderDebateLines(
          {
            ...view,
            action: suggestion.action,
            direction: framedDirectionOf(suggestion),
            unsupported: unsupportedSet(suggestion),
            ...(suggestion.thesis === undefined ? {} : { thesis: suggestion.thesis }),
          },
          suggestion.debate
        ),
    renderUnsupportedClaims(view, suggestion),
    renderSourceLines(locale, suggestion, view.detail),
    renderCaveatLines(locale, filteredCaveats(suggestion)),
  ]
}

/** The levels plus how the size moves through them. The ladders drop when the profile is
 *  unread; the levels stand without them. */
export function planOptions(view: RenderView, quote: QuotedIn | undefined): PlanLinesOptions {
  return {
    ...(quote === undefined ? {} : { quote }),
    ...(view.minimumRiskReward === undefined ? {} : { minimumRiskReward: view.minimumRiskReward }),
    ...(view.entryTranchePct === undefined ? {} : { entryTranchePct: view.entryTranchePct }),
    ...(view.boardLot === undefined ? {} : { boardLot: view.boardLot }),
    ...(view.trailsStop === undefined ? {} : { trailsStop: view.trailsStop }),
  }
}

export function renderCalibrationLine(
  view: RenderView,
  suggestion: StoredSuggestion
): readonly string[] {
  const { locale, calibration } = view

  if (calibration === undefined || calibration.winRate === undefined) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.suggestion.calibration', {
      conviction: renderDeclaredValue(locale, `trading.conviction.${suggestion.conviction}`),
      rate: formatFraction(locale, calibration.winRate),
      count: formatCount(locale, calibration.resolvedCount),
    })}`,
  ]
}

/** On an actionable row the thesis is the reasoning behind the call; on a hold it is the case a
 *  later gate refused, and titling that "conclusion" closed a refused idea with a paragraph
 *  arguing to take it. */
function renderThesisLines(locale: Locale, suggestion: StoredSuggestion): readonly string[] {
  if (suggestion.thesis === undefined) {
    return []
  }

  const key =
    suggestion.action === 'hold'
      ? 'trading.render.suggestion.thesisConsidered'
      : 'trading.render.suggestion.thesis'

  return [
    renderSectionTitle(SECTION_ICONS.thesis, t(locale, key)),
    `${INDENT[1]}${suggestion.thesis}`,
  ]
}
