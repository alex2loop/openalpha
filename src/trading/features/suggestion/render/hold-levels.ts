import type { Locale } from '@/core/types/locale'
import type { OperatorFigures } from '@/trading/features/suggestion/render/sections'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { BoardLotPolicy, Ticker } from '@/trading/kernel/instrument'
import type { QuotedIn } from '@/trading/render/money'
import { t } from '@/i18n'
import {
  bankedShareOf,
  firstExitRiskReward,
  heldFirstExitOf,
} from '@/trading/features/suggestion/exit-plan/first-exit'
import { renderDealerBoardLines } from '@/trading/features/suggestion/render/plan'
import { withheldSuffix } from '@/trading/features/suggestion/render/sections'
import {
  armsExit,
  framedDirectionOf,
  isRecordedPlan,
  planStopOf,
  planTakeProfitOf,
} from '@/trading/features/suggestion/types'
import { isNearStop } from '@/trading/kernel/operator/alert'
import { exitPriceOf } from '@/trading/markets/stored-quote'
import {
  formatFixedFraction,
  formatFraction,
  formatQuantity,
  formatRatio,
  formatSignedFraction,
  formatWholeFraction,
} from '@/trading/render/format'
import { INDENT } from '@/trading/render/layout'
import { formatPriceIn } from '@/trading/render/money'
import { FRACTION_QUANTUM } from '@/trading/render/number'

interface HoldLevelsInput {
  readonly locale: Locale
  readonly suggestion: StoredSuggestion
  /** How the market prints a price. */
  readonly quoted?: Partial<QuotedIn>
  /** Whether the market raises a held name's stop as it runs. Absent reads as no. */
  readonly trailsStop?: boolean
  /** The market's smallest accepted quantity, which the first sale is floored to. */
  readonly boardLot?: BoardLotPolicy
  readonly operatorFigures: OperatorFigures
}

interface HeldLevelsInput {
  readonly locale: Locale
  readonly suggestion: StoredSuggestion
  readonly quoted: Partial<QuotedIn>
  readonly isReduce: boolean
  readonly levels: { readonly stop: number; readonly target: number }
  readonly held: NonNullable<StoredSuggestion['held']>
  readonly entry: number
  readonly trailsStop: boolean
  readonly boardLot?: BoardLotPolicy
  readonly operatorFigures: OperatorFigures
}

/** A holder never traded the entry the run would have taken, so the row drops it and measures the
 *  moves off the cost they did pay - or off today's price where that cost is withheld. The plan's
 *  risk-to-reward is a property of that entry, so it stays on the entry row: beside cost-based
 *  moves it would contradict the figures next to it. A declined sale states the exits the position
 *  still runs on, never the sale's own target, which a holder reads as their stop. */
function heldLevelLines(input: HeldLevelsInput): readonly string[] {
  const { locale, quoted, held, operatorFigures } = input
  const standing = input.suggestion.standingExit
  const mark = holdingMarkOf(input.suggestion, input.entry)
  const reference = operatorFigures === 'withheld' ? mark : held.unitCostNative
  const withheld = withheldSuffix(operatorFigures)

  if (input.isReduce && standing === undefined) {
    return declinedSaleLines(locale, {
      ticker: input.suggestion.instrument.ticker,
      unitCost: formatPriceIn(locale, held.unitCostNative, quoted),
      exits: levelParams(locale, { ...input.levels, reference }, quoted),
      withheld,
    })
  }

  const levels =
    standing === undefined ? input.levels : { ...input.levels, target: standing.takeProfit }
  const exits = levelParams(locale, { ...levels, reference }, quoted)
  const suffix = armsExit(input.suggestion) ? '' : 'Fund'

  return [
    `${INDENT[1]}${t(locale, `trading.render.suggestion.holdLevelsIntroHeld${suffix}${withheld}`)}`,
    ...levelRows([
      t(locale, `trading.render.suggestion.holdLevelsStop${suffix}`, exits),
      t(locale, 'trading.render.suggestion.holdLevelsTakeProfit', exits),
    ]),
    ...bookRiskLines(locale, { held, mark, stop: levels.stop, suffix, operatorFigures }),
    ...(input.isReduce ? [] : heldTrancheLines(input)),
  ]
}

/** The split a fresh entry is told, stated for the units already owned: the take-profit banks a
 *  tranche and the rest rides the trail. A price already past it makes that sale due now. */
function heldTrancheLines(input: HeldLevelsInput): readonly string[] {
  const { locale, quoted, held } = input
  const banked = bankedShareOf(input.suggestion, input.trailsStop)
  const takeProfit = input.levels.target

  if (banked >= 1) {
    return []
  }

  const exit = heldFirstExitOf(held, banked, input.boardLot?.size)
  const price = formatPriceIn(locale, takeProfit, quoted)
  // A holder who already sold the tranche has taken that step; asking again would bank it twice.
  const line =
    exit.kind === 'taken'
      ? t(locale, 'trading.render.suggestion.holdLevelsTrancheTaken', {
          sold: formatWholeFraction(locale, exit.soldShare),
          share: formatWholeFraction(locale, banked),
          price,
        })
      : t(locale, `trading.render.suggestion.${trancheKeyOf(input, takeProfit)}`, {
          tranche: trancheOrder(input, exit),
          price,
        })

  return [`${INDENT[2]}${line}`]
}

function trancheKeyOf(
  input: HeldLevelsInput,
  takeProfit: number
): 'holdLevelsTranche' | 'holdLevelsTrancheReached' {
  return holdingMarkOf(input.suggestion, input.entry) >= takeProfit
    ? 'holdLevelsTrancheReached'
    : 'holdLevelsTranche'
}

/** The plan's levels one per row. Under an actionable headline they are the order itself; on a
 *  hold they follow an intro saying what they are, since a declined call's levels are no order. */
export function renderLevelLines(input: HoldLevelsInput): readonly string[] {
  const { locale, suggestion } = input
  const quoted = input.quoted ?? {}

  if (suggestion.entry === undefined) {
    return []
  }

  const { entry, target, takeProfit, riskReward, held } = suggestion
  // An actionable headline prices the plan's live stop, as the order notes under it do.
  const stop = suggestion.action === 'hold' ? suggestion.stop : planStopOf(suggestion)

  if (stop === undefined || target === undefined || riskReward === undefined) {
    return []
  }

  const isReduce = framedDirectionOf(suggestion) === 'reduce'
  const arm = isReduce ? 'Reduce' : ''
  const shared = {
    entry: formatPriceIn(locale, entry, quoted),
    ...levelParams(locale, { stop, target, reference: entry }, quoted),
    rr: formatRatio(locale, riskReward),
  }
  const rows = [
    t(locale, `trading.render.suggestion.holdLevelsEntry${arm}`, shared),
    t(locale, `trading.render.suggestion.holdLevelsStop${stopArmOf(suggestion, arm)}`, shared),
    ...exitRows(input, { entry, stop, target, takeProfit: takeProfit ?? target }, shared),
  ]

  if (suggestion.action !== 'hold') {
    return rows.map((row) => `${INDENT[1]}${row}`)
  }

  const armedStop = heldStopOf(suggestion, stop)
  const proximity = closingLines(input, { entry, stop: armedStop, isReduce })

  if (held !== undefined && held.unitCostNative > 0) {
    return [
      ...heldLevelLines({
        ...input,
        quoted,
        isReduce,
        // A holder acts at the take-profit; the target and R:R below describe a fresh entry.
        levels: { stop: armedStop, target: planTakeProfitOf(suggestion) ?? target },
        held,
        entry,
        trailsStop: input.trailsStop === true,
      }),
      ...proximity,
    ]
  }

  // A recorded plan is not a declined call, so its intro says what the position is watched against
  // rather than offering the buy the run never weighed. The held arm above already reads that way.
  const tail = isRecordedPlan(suggestion) ? 'Recorded' : arm

  return [
    `${INDENT[1]}${t(locale, `trading.render.suggestion.holdLevelsIntro${tail}`)}`,
    ...levelRows(rows),
    ...proximity,
  ]
}

/** A level that arms nothing is where the plan is reviewed, never a stop. */
function stopArmOf(suggestion: StoredSuggestion, arm: '' | 'Reduce'): '' | 'Reduce' | 'Fund' {
  return arm === '' && !armsExit(suggestion) ? 'Fund' : arm
}

/** One level per row, so a price the reader acts on never shares a line with the next one. */
function levelRows(levels: readonly string[]): readonly string[] {
  return levels.map((level) => `${INDENT[2]}${level}`)
}

/** The stop a holding is watched against: the level the exit tick trailed to, else the standing
 *  plan's, else this row's own. */
function heldStopOf(suggestion: StoredSuggestion, stop: number): number {
  return suggestion.trailingStop ?? suggestion.standingExit?.stop ?? stop
}

/** What the holding sells for now, which on a dealer board is the shop's buying price rather than
 *  the selling price a fresh entry pays: the room to the stop is measured from there. */
function holdingMarkOf(suggestion: StoredSuggestion, entry: number): number {
  return suggestion.quote === undefined ? entry : exitPriceOf(suggestion.quote)
}

/** The exits past the stop in the order the operator meets them: a tranche banked before the
 *  target is its own row and the R:R is the take-profit's. A sale, a fund and a market with no
 *  trail exit whole at the target, so they keep the single target row and the row's own ratio. */
function exitRows(
  input: HoldLevelsInput,
  levels: { entry: number; stop: number; takeProfit: number; target: number },
  shared: Record<string, string>
): readonly string[] {
  const { locale, suggestion } = input
  const banked = bankedShareOf(suggestion, input.trailsStop === true)
  const arm = framedDirectionOf(suggestion) === 'reduce' ? 'Reduce' : ''

  if (banked >= 1) {
    return [
      t(locale, `trading.render.suggestion.holdLevelsTarget${arm}`, shared),
      t(locale, 'trading.render.suggestion.holdLevelsRiskReward', shared),
    ]
  }

  const { entry, takeProfit, target } = levels
  const ladder = takeProfit < target
  const params = {
    ...shared,
    tranche: formatWholeFraction(locale, banked),
    takeProfit: formatPriceIn(locale, takeProfit, input.quoted ?? {}),
    takeProfitPct: formatSignedFraction(locale, (takeProfit - entry) / entry),
    rr: formatRatio(locale, firstExitRiskReward(levels, banked)),
  }

  return [
    t(
      locale,
      `trading.render.suggestion.holdLevelsTakeProfit${ladder ? 'Ladder' : 'Trail'}`,
      params
    ),
    ...(ladder ? [t(locale, 'trading.render.suggestion.holdLevelsTargetFar', params)] : []),
    t(locale, 'trading.render.suggestion.holdLevelsRiskRewardTakeProfit', params),
  ]
}

/** The first sale as an order the venue accepts, stated with the share of the units held it is. */
function trancheOrder(
  input: HeldLevelsInput,
  exit: { readonly shareOfHeld: number; readonly units?: number }
): string {
  const share = formatWholeFraction(input.locale, exit.shareOfHeld)

  if (exit.units === undefined || input.operatorFigures === 'withheld') {
    return t(input.locale, 'trading.render.suggestion.holdLevelsTrancheShare', { share })
  }

  return t(input.locale, 'trading.render.suggestion.holdLevelsTrancheUnits', {
    quantity: formatQuantity(input.locale, exit.units),
    ticker: input.suggestion.instrument.ticker,
    share,
  })
}

/** What follows the levels: how near the stop sits, and which side of a dealer board they read. */
function closingLines(
  input: HoldLevelsInput,
  levels: { readonly entry: number; readonly stop: number; readonly isReduce: boolean }
): readonly string[] {
  const { locale, suggestion } = input
  const { entry, stop, isReduce } = levels

  return [
    ...stopProximityLines(locale, suggestion, { mark: holdingMarkOf(suggestion, entry), stop }),
    ...(isReduce ? [] : renderDealerBoardLines(locale, suggestion, input.quoted)),
  ]
}

interface BookRiskInput {
  readonly held: NonNullable<StoredSuggestion['held']>
  readonly mark: number
  readonly stop: number
  readonly suffix: '' | 'Fund'
  readonly operatorFigures: OperatorFigures
}

/** What reaching the stop costs the book rather than the position, from what it is worth now - a
 *  gain given back reads as a loss unless the line says which. Where the stop sits under the
 *  holder's cost the real loss is stated beside it. Silent where it rounds away, or where the book
 *  has no weight. */
function bookRiskLines(locale: Locale, input: BookRiskInput): readonly string[] {
  const { held, mark, stop } = input

  if (held.pctNav === undefined || mark <= stop) {
    return []
  }

  const risk = (held.pctNav * (mark - stop)) / mark
  const loss = (held.pctNav * (held.unitCostNative - stop)) / mark

  if (risk < FRACTION_QUANTUM) {
    return []
  }

  const arm = bookRiskArm(input, loss)

  return [
    `${INDENT[2]}${t(locale, `trading.render.suggestion.holdLevelsBookRisk${arm}`, {
      risk: formatFraction(locale, risk),
      loss: formatFraction(locale, loss),
    })}`,
  ]
}

/** A fund's line names no cost. Every other line says how the stop sits against what was paid,
 *  unless that cost is withheld. */
function bookRiskArm(
  input: BookRiskInput,
  loss: number
): '' | 'Fund' | 'BelowCost' | ReturnType<typeof withheldSuffix> {
  if (input.suffix === 'Fund') {
    return 'Fund'
  }

  const withheld = withheldSuffix(input.operatorFigures)

  if (withheld !== '') {
    return withheld
  }

  return loss >= FRACTION_QUANTUM ? 'BelowCost' : ''
}

/** How far the market sits from a held position's stop. The rows above measure their moves off the
 *  holder's cost, which says nothing about how much room is left: a plan can read as a comfortable
 *  1,92% below cost while the close stands one tick above the level that closes it. Same threshold
 *  the book's attention line uses. Silent where nothing would fill: a name not held, or a level
 *  that arms no exit. */
function stopProximityLines(
  locale: Locale,
  suggestion: StoredSuggestion,
  levels: { readonly mark: number; readonly stop: number }
): readonly string[] {
  if (suggestion.held === undefined || !armsExit(suggestion)) {
    return []
  }

  const distance = (levels.mark - levels.stop) / levels.mark

  return isNearStop(distance)
    ? [
        `${INDENT[2]}${t(locale, 'trading.render.suggestion.stopNear', {
          pct: formatFixedFraction(locale, distance),
        })}`,
      ]
    : []
}

interface DeclinedSaleInput {
  readonly ticker: Ticker
  readonly unitCost: string
  readonly exits: Record<string, string>
  readonly withheld: ReturnType<typeof withheldSuffix>
}

/** A sale the run weighed and declined on a position with no standing plan. Its levels are a
 *  short's, so only the stop takes a line, stating what reaching it would mean for the position the
 *  holder still has. The target below the market is left out: it reads as a stop to a holder, and
 *  nothing is armed there. */
function declinedSaleLines(locale: Locale, input: DeclinedSaleInput): readonly string[] {
  const { ticker, unitCost, exits, withheld } = input

  return [
    `${INDENT[1]}${t(locale, `trading.render.suggestion.holdLevelsIntroHeldReduce${withheld}`, { ticker, unitCost })}`,
    `${INDENT[2]}${t(locale, 'trading.render.suggestion.holdLevelsRowHeldReduceStop', exits)}`,
  ]
}

interface HoldLevels {
  readonly stop: number
  readonly target: number
  /** What the two percentages are measured from: the run's entry, or the holder's own cost. */
  readonly reference: number
}

function levelParams(
  locale: Locale,
  levels: HoldLevels,
  quoted: Partial<QuotedIn>
): Record<string, string> {
  const { stop, target, reference } = levels

  return {
    stop: formatPriceIn(locale, stop, quoted),
    stopPct: formatSignedFraction(locale, (stop - reference) / reference),
    target: formatPriceIn(locale, target, quoted),
    targetPct: formatSignedFraction(locale, (target - reference) / reference),
  }
}
