import type { Locale } from '@/core/types/locale'
import type { HeldPosition } from '@/trading/features/suggestion/exposure'
import type { OperatorFigures } from '@/trading/features/suggestion/render/sections'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { TradeCost } from '@/trading/markets/cost'
import type { QuotedIn } from '@/trading/render/money'
import { formatDay, t } from '@/i18n'
import { withheldSuffix } from '@/trading/features/suggestion/render/sections'
import { armsExit, framedDirectionOf, planStopOf } from '@/trading/features/suggestion/types'
import { exitBreakevenPrice } from '@/trading/markets/cost'
import { exitPriceOf } from '@/trading/markets/stored-quote'
import { formatQuantity, formatRatio, formatSignedFraction } from '@/trading/render/format'
import { INDENT } from '@/trading/render/layout'
import { formatPriceIn } from '@/trading/render/money'
import { renderStopRaised } from '@/trading/render/stop-raised'

const STOP_ROW_KEYS = Object.freeze({
  kept: 'heldExitStop',
  reached: 'heldExitStopBreached',
} as const)
const REVIEW_ROW_KEYS = Object.freeze({
  kept: 'heldExitReviewFund',
  reached: 'heldExitReviewFundReached',
} as const)

interface HeldExit {
  readonly held: HeldPosition
  readonly unitCost: number
  /** The basis an exit has to clear: the recorded entry cost plus what the sale itself will take.
   *  Equal to `unitCost` when the market has no configured rate. */
  readonly exitBreakeven: number
  /** Absent on a hold, which carries no plan levels of its own. */
  readonly stop?: number
  readonly takeProfit?: number
  /** Absent when the quote source failed. Everything measured from here is then absent too. */
  readonly mark?: number
}

interface HeldExitInput {
  readonly locale: Locale
  readonly suggestion: StoredSuggestion
  readonly quote?: QuotedIn
  readonly cost?: TradeCost
  /** Whether a venue holding the market takes orders from this tree, so a raised stop names the
   *  command that moves one resting there. */
  readonly placesOrders: boolean
  readonly operatorFigures: OperatorFigures
}

/** The exit for units the operator already owns, which the plan block cannot state: its levels are
 *  anchored to an entry nobody has paid. Risk and reward here are measured from the mark - cost is
 *  sunk, and it appears only as what a fill at a level would realize. */
export function renderHeldExit(input: HeldExitInput): readonly string[] {
  return [...exitRows(input), ...raisedStopRows(input)]
}

function exitRows(input: HeldExitInput): readonly string[] {
  const { locale, quote } = input
  const exit = heldExitOf(input)

  if (exit === undefined) {
    return []
  }

  const settled = settledRows(input, exit.held)
  // Every other row measures a sale against what the operator paid.
  const rows =
    input.operatorFigures === 'withheld'
      ? settled
      : [
          costRow(locale, exit, quote),
          ...settled,
          ...saleRows(input, exit),
          ...stopRows(input, exit),
          ...takeProfitRows(locale, exit, quote),
        ]

  return rows.map((line) => `${INDENT[1]}${line}`)
}

/** A stop this run set above the standing plan's moves nothing resting at an exchange, so the block
 *  says where it came from and what to do with the order behind it. */
function raisedStopRows(input: HeldExitInput): readonly string[] {
  const { suggestion } = input
  const { raisedStopFrom, stop } = suggestion

  if (raisedStopFrom === undefined || stop === undefined) {
    return []
  }

  return renderStopRaised(input.locale, {
    instrument: suggestion.instrument,
    from: raisedStopFrom,
    to: stop,
    quoted: input.quote ?? {},
    placement: input.placesOrders ? 'unread' : 'by-hand',
  })
}

/** Absent unless every number the block prints is real. Runs on every arm that holds units: selling
 *  300 at 61,30 against a basis of 72,00 locks a loss and against 45,00 takes a profit, and without
 *  this the two read identically. Only a buy carries levels for the units kept, so on the other two
 *  arms the stop and take-profit rows sit out. */
function heldExitOf(input: HeldExitInput): HeldExit | undefined {
  const { cost, suggestion } = input
  const { held } = suggestion

  if (held === undefined) {
    return undefined
  }

  const unitCost = held.unitCostNative

  if (!(unitCost > 0 && Number.isFinite(unitCost))) {
    return undefined
  }

  const exitBreakeven = cost === undefined ? unitCost : exitBreakevenPrice(unitCost, cost)
  const mark = suggestion.quote === undefined ? undefined : exitPriceOf(suggestion.quote)
  // Only a buy's levels protect the units kept. A reduce's are the mirror image of a sale — its
  // stop sits above entry and its target below — so read as a holding's exit they invert: the stop
  // reads as breached at every price under it, and the target as a profit at a loss.
  const plan = suggestion.action === 'buy' ? suggestion : undefined
  const takeProfit = plan?.standingTakeProfit ?? plan?.takeProfit

  return {
    held,
    unitCost,
    exitBreakeven,
    ...stopField(plan === undefined ? undefined : planStopOf(plan)),
    ...(takeProfit === undefined ? {} : { takeProfit }),
    ...(mark === undefined ? {} : { mark }),
  }
}

/** How far a sale at this price lands from the one that breaks even, as a fraction of it. The exit's
 *  own cost already sits inside `exitBreakeven`, so charging it again here would take it twice - and
 *  this is identical to measuring net proceeds against what was paid. */
function realizedFraction(exit: HeldExit, price: number): number {
  return (price - exit.exitBreakeven) / exit.exitBreakeven
}

/** A hold or a reduce reaches here with no plan stop, so the field is absent rather than zero. */
function stopField(stop: number | undefined): { readonly stop?: number } {
  return stop === undefined ? {} : { stop }
}

/** The price a sale would happen at, when one is on the table: a reduce's own sale price, or the
 *  mark when a weakening thesis puts the whole position up for review. A buy has no sale to price. */
function salePrice(suggestion: StoredSuggestion, exit: HeldExit): number | undefined {
  if (suggestion.action === 'reduce') {
    return suggestion.entry
  }

  return suggestion.action === 'hold' && framedDirectionOf(suggestion) === 'reduce'
    ? exit.mark
    : undefined
}

function saleRows(input: HeldExitInput, exit: HeldExit): readonly string[] {
  const { locale, quote } = input
  const price = salePrice(input.suggestion, exit)

  if (price === undefined) {
    return []
  }

  return [
    t(locale, 'trading.render.suggestion.heldExitSale', {
      price: formatPriceIn(locale, price, quote),
      realized: formatSignedFraction(locale, realizedFraction(exit, price)),
    }),
  ]
}

function costRow(locale: Locale, exit: HeldExit, quote?: QuotedIn): string {
  const unitCost = formatPriceIn(locale, exit.unitCost, quote)

  if (exit.mark === undefined) {
    return t(locale, 'trading.render.suggestion.heldExitCostUnpriced', { unitCost })
  }

  return t(locale, 'trading.render.suggestion.heldExitCost', {
    unitCost,
    pnl: formatSignedFraction(locale, (exit.mark - exit.unitCost) / exit.unitCost),
  })
}

/** Only settled units can be sold, so a plan over the whole holding is not actionable without it.
 *  Judged on the two rendered quantities: equal ones state a constraint they then deny. */
/** When the units bought last become sellable, so a sale the plan asks for is not read as possible
 *  today. Nothing to say once every unit has settled. */
function settledRows(input: HeldExitInput, held: HeldPosition): readonly string[] {
  const { locale } = input
  const settled = formatQuantity(locale, held.settledUnits)
  const units = formatQuantity(locale, held.units)

  if (held.settlesOn === undefined || settled === units) {
    return []
  }

  const params = {
    ticker: input.suggestion.instrument.ticker,
    settled,
    units,
    day: formatDay(locale, held.settlesOn),
  }
  const key = held.settledUnits > 0 ? 'heldExitSettled' : 'heldExitUnsettled'
  const suffix = withheldSuffix(input.operatorFigures)

  return [t(locale, `trading.render.suggestion.${key}${suffix}`, params)]
}

/** A fund's lower level arms nothing, so it is named as the level to look again at, never a stop. */
function stopRows(input: HeldExitInput, exit: HeldExit): readonly string[] {
  const { locale, quote } = input

  if (exit.stop === undefined) {
    return []
  }

  const stop = formatPriceIn(locale, exit.stop, quote)
  const { kept, reached } = armsExit(input.suggestion) ? STOP_ROW_KEYS : REVIEW_ROW_KEYS

  if (exit.mark !== undefined && exit.mark <= exit.stop) {
    return [t(locale, `trading.render.suggestion.${reached}`, { stop })]
  }

  return [
    t(locale, `trading.render.suggestion.${kept}`, {
      stop,
      realized: formatSignedFraction(locale, realizedFraction(exit, exit.stop)),
    }),
  ]
}

/** Absent once the stop is breached: a triggered exit has no forward reward, and restating the
 *  take-profit under it reads as a plan that is still running. */
function takeProfitRows(locale: Locale, exit: HeldExit, quote?: QuotedIn): readonly string[] {
  const { mark, stop } = exit

  if (exit.takeProfit === undefined || (mark !== undefined && stop !== undefined && mark <= stop)) {
    return []
  }

  const target = formatPriceIn(locale, exit.takeProfit, quote)
  const realized = formatSignedFraction(locale, realizedFraction(exit, exit.takeProfit))

  if (mark === undefined) {
    return [t(locale, 'trading.render.suggestion.heldExitTargetUnpriced', { target, realized })]
  }

  if (exit.takeProfit <= mark) {
    return [t(locale, 'trading.render.suggestion.heldExitTargetReached', { target, realized })]
  }

  const key = exit.takeProfit < exit.exitBreakeven ? 'heldExitTargetBelowCost' : 'heldExitTarget'

  return [
    t(locale, `trading.render.suggestion.${key}`, {
      target,
      realized,
      ...(stop === undefined
        ? {}
        : { rr: formatRatio(locale, (exit.takeProfit - mark) / (mark - stop)) }),
    }),
  ]
}
