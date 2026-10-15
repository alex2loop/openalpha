import type { RenderView } from '@/trading/features/suggestion/render/view'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { QuotedIn } from '@/trading/render/money'
import { t } from '@/i18n'
import {
  holdReasonLines,
  levelQuote,
  verdictOf,
} from '@/trading/features/suggestion/render/headline'
import { renderHeldExit } from '@/trading/features/suggestion/render/held-exit'
import { renderHoldLevels } from '@/trading/features/suggestion/render/hold-levels'
import { renderOrderNotes } from '@/trading/features/suggestion/render/order'
import { renderPlanLines } from '@/trading/features/suggestion/render/plan'
import { shownCall } from '@/trading/features/suggestion/render/second-opinion'
import {
  renderReduceReasonLines,
  renderScaledSizeLine,
  renderThesisBreakLines,
} from '@/trading/features/suggestion/render/sections'
import {
  planOptions,
  renderCalibrationLine,
  renderDetailBlocks,
  renderFactLines,
} from '@/trading/features/suggestion/render/suggestion'
import { inconclusiveBanner, isInconclusive } from '@/trading/features/suggestion/render/verdict'

export interface SuggestionCard {
  readonly verdict: string
  /** What the run read and when: evidence day, earlier calls, stamp, quote, scale, holding. */
  readonly facts: readonly string[]
  readonly reasons: readonly string[]
  readonly levels: readonly string[]
  readonly notes: readonly string[]
  readonly calibration?: string
  /** The rest of `/suggest` after the plan, one block each: factors, debate, thesis, what would
   *  break it, sources and caveats. */
  readonly details: readonly (readonly string[])[]
  readonly disclaimer: string
}

/** The decision card an app shows: the sentences `/suggest` prints, without the section title and
 *  indentation a chat needs (the app lays the lines out itself). */
export function renderSuggestionCard(view: RenderView, call: StoredSuggestion): SuggestionCard {
  const suggestion = shownCall(call)
  const quote = levelQuote(view, suggestion)
  const inconclusive = isInconclusive(suggestion)
  const [calibration] = renderCalibrationLine(view, suggestion)

  return {
    verdict: verdictOf(view, suggestion),
    facts: trimmed([
      ...renderFactLines(view, suggestion),
      ...(inconclusive ? inconclusiveBanner(view.locale, suggestion) : []),
    ]),
    reasons: trimmed([
      ...renderReduceReasonLines(view.locale, suggestion),
      ...renderScaledSizeLine(view.locale, suggestion),
      ...renderThesisBreakLines(view.locale, suggestion),
      ...holdReasonLines(view.locale, suggestion, inconclusive),
    ]),
    levels: trimmed(levelLines(view, suggestion, quote)),
    notes: trimmed([
      ...renderHeldExit({
        locale: view.locale,
        suggestion,
        ...(quote === undefined ? {} : { quote }),
        ...(view.cost === undefined ? {} : { cost: view.cost }),
        placesOrders: view.placesOrders === true,
        operatorFigures: view.operatorFigures,
      }),
      ...renderOrderNotes({
        locale: view.locale,
        suggestion,
        ...(quote === undefined ? {} : { quote }),
        ...(view.cost === undefined ? {} : { cost: view.cost }),
        trailsStop: view.trailsStop === true,
      }),
    ]),
    ...(calibration === undefined ? {} : { calibration: calibration.trimStart() }),
    details: renderDetailBlocks(view, suggestion)
      .map(trimmed)
      .filter((block) => block.length > 0),
    disclaimer: t(view.locale, 'trading.render.suggestion.disclaimerApp'),
  }
}

/** A buy's plan without its bold section title, or a hold's watch levels. */
function levelLines(
  view: RenderView,
  suggestion: StoredSuggestion,
  quote: QuotedIn | undefined
): readonly string[] {
  if (suggestion.action === 'buy') {
    return renderPlanLines(view.locale, suggestion, planOptions(view, quote)).slice(1)
  }

  if (suggestion.action !== 'hold' || isInconclusive(suggestion)) {
    return []
  }

  return renderHoldLevels({
    locale: view.locale,
    suggestion,
    context: view.context,
    trailsStop: view.trailsStop === true,
    operatorFigures: view.operatorFigures,
    ...(view.boardLot === undefined ? {} : { boardLot: view.boardLot }),
    ...(quote === undefined ? {} : { quoted: quote }),
  })
}

function trimmed(lines: readonly string[]): readonly string[] {
  return lines.map((line) => line.trimStart())
}
