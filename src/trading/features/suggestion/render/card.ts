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
import { renderLevelLines } from '@/trading/features/suggestion/render/hold-levels'
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
  renderFactorBlock,
  renderFacts,
} from '@/trading/features/suggestion/render/suggestion'
import { inconclusiveBanner } from '@/trading/features/suggestion/render/verdict'
import { isInconclusive } from '@/trading/features/suggestion/types'

export interface SuggestionCard {
  readonly verdict: string
  /** What the run read and when: evidence day, earlier calls, stamp, quote, scale, holding. */
  readonly facts: readonly string[]
  readonly reasons: readonly string[]
  readonly levels: readonly string[]
  readonly notes: readonly string[]
  readonly calibration?: string
  /** The factor block without its title: the composite, the checklist and the fold below it. Each
   *  line keeps its leading indent, two spaces a level. */
  readonly factors: readonly string[]
  /** What the trader waits on before the entry, each a condition it can be checked against. */
  readonly watch: readonly string[]
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
  const facts = renderFacts(view, suggestion)

  return {
    verdict: verdictOf(view, suggestion),
    facts: trimmed([
      ...facts.head,
      ...facts.context,
      ...(inconclusive ? inconclusiveBanner(view.locale, suggestion) : []),
    ]),
    reasons: trimmed([
      ...renderReduceReasonLines(view.locale, suggestion),
      ...renderScaledSizeLine(view.locale, suggestion),
      ...renderThesisBreakLines(view.locale, suggestion),
      ...holdReasonLines(view.locale, suggestion, inconclusive),
    ]),
    levels: trimmed(levelLines(view, suggestion, quote)),
    notes: trimmed(noteLines(view, suggestion, quote)),
    ...(calibration === undefined ? {} : { calibration: calibration.trimStart() }),
    // Indented as printed: the checklist's groups and readings are told apart by depth alone.
    factors: renderFactorBlock(view, suggestion, quote).slice(1),
    watch: trimmed(watchConditions(suggestion)),
    details: renderDetailBlocks(view, suggestion)
      .map(trimmed)
      .filter((block) => block.length > 0),
    disclaimer: t(view.locale, 'trading.render.suggestion.disclaimerApp'),
  }
}

/** What to do with the plan beside its levels: the held exit and the order notes. */
function noteLines(
  view: RenderView,
  suggestion: StoredSuggestion,
  quote: QuotedIn | undefined
): readonly string[] {
  return [
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
  ]
}

/** The plan's levels, then a buy's plan without its bold section title. */
function levelLines(
  view: RenderView,
  suggestion: StoredSuggestion,
  quote: QuotedIn | undefined
): readonly string[] {
  if (isInconclusive(suggestion)) {
    return []
  }

  return [
    ...renderLevelLines({
      locale: view.locale,
      suggestion,
      trailsStop: view.trailsStop === true,
      operatorFigures: view.operatorFigures,
      ...(view.boardLot === undefined ? {} : { boardLot: view.boardLot }),
      ...(quote === undefined ? {} : { quoted: quote }),
    }),
    ...(suggestion.action === 'buy'
      ? renderPlanLines(view.locale, suggestion, planOptions(view, quote)).slice(1)
      : []),
  ]
}

/** Every condition the trader waits on, where `/suggest` caps a compact read: the page has room for
 *  all of them. A lean debate runs no trader, and one that would enter waits on nothing. */
function watchConditions(suggestion: StoredSuggestion): readonly string[] {
  const { debate } = suggestion

  return debate?.mode === 'full' && debate.traderStance !== 'enter' ? debate.traderConditions : []
}

function trimmed(lines: readonly string[]): readonly string[] {
  return lines.map((line) => line.trimStart())
}
