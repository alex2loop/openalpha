import type { Suggestion } from '@/trading/features/suggestion/types'
import type { Stage, StageDecision, StageInput } from '@/trading/markets/stage'
import { openLots } from '@/trading/features/portfolio/folds/holdings'
import { lowerBand } from '@/trading/kernel/conviction'
import { ETF_KIND, isSameInstrument } from '@/trading/kernel/instrument'
import { loweredDecision, STAGE_PASS } from '@/trading/markets/stage'
import { exitPriceOf } from '@/trading/markets/stored-quote'

const AVERAGING_DOWN_STAGE_ID = 'averaging-down'
/** Last in the risk phase: a market's own read on the name comes first, and this judges the add
 *  the book is making whatever that read concluded. */
const AVERAGING_DOWN_STAGE_ORDER = 40

/** How far under the basis the holding must sit before adding to it reads as averaging down rather
 *  than as topping up a name that has barely moved. A chosen value; no backtest justifies 0.05 over
 *  a neighbouring one. Named `_FRACTION`, not `_PCT`: 0.05 is 5%, never scaled by 100 first. */
const AVERAGING_DOWN_THRESHOLD_FRACTION = 0.05

/** Buying more of a single name the book is already losing on rests the add on the same thesis the
 *  price is contradicting. An ETF is exempt: an index has no single-name thesis to be wrong about,
 *  which is the one place the evidence says accumulating into weakness is sound. */
export function createAveragingDownStage(): Stage {
  return {
    id: AVERAGING_DOWN_STAGE_ID,
    phase: 'risk',
    order: AVERAGING_DOWN_STAGE_ORDER,
    evaluate: (input) => Promise.resolve(evaluate(input)),
  }
}

function evaluate(input: StageInput): StageDecision {
  const { suggestion } = input

  if (suggestion.action !== 'buy' || input.instrumentKind === ETF_KIND) {
    return STAGE_PASS
  }

  const underwater = underwaterFraction(suggestion, dividendPerUnitOf(input))

  if (underwater === undefined || underwater < AVERAGING_DOWN_THRESHOLD_FRACTION) {
    return STAGE_PASS
  }

  return loweredDecision(suggestion.conviction, lowerBand(suggestion.conviction), [
    { code: 'suggestion.averaging-down', detail: { underwater } },
  ])
}

/** How far the mark sits under the fee-bearing basis less the cash dividends the units earned, as a
 *  fraction; negative on a position in profit, absent when the name is unheld or the market
 *  published no quote. An ex-date takes the dividend off the price, so a basis that kept it would
 *  read every dividend as a loss. Both figures are in the market's own currency, so no FX rate
 *  enters a reading taken against the levels beside it. */
function underwaterFraction(suggestion: Suggestion, dividendPerUnit: number): number | undefined {
  const held = suggestion.held?.unitCostNative
  const unitCost = held === undefined ? undefined : held - dividendPerUnit
  const mark = suggestion.quote === undefined ? undefined : exitPriceOf(suggestion.quote)

  if (unitCost === undefined || mark === undefined || unitCost <= 0) {
    return undefined
  }

  return 1 - mark / unitCost
}

/** The cash dividend each unit still held earned: an open lot earns every dividend that went ex after
 *  it was bought, through the run's day, whether or not the cash has landed. */
function dividendPerUnitOf(input: StageInput): number {
  const { instrument, at } = input.suggestion
  const lots = openLots(
    input.valued.book.positions
      .filter((position) => isSameInstrument(position.instrument, instrument))
      .flatMap((position) => position.lots)
  )
  const units = lots.reduce((sum, lot) => sum + lot.remainingQuantity, 0)
  const dividends = (input.events ?? []).filter(
    (event) => event.kind === 'dividend-ex-date' && event.at <= at
  )
  const owed = lots.reduce(
    (sum, lot) =>
      sum +
      lot.remainingQuantity *
        dividends
          .filter((event) => event.at > lot.acquiredAt)
          .reduce((cash, event) => cash + (event.cashPerShare ?? 0), 0),
    0
  )

  return units > 0 ? owed / units : 0
}
