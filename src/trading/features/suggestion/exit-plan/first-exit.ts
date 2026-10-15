import type { HeldPosition } from '@/trading/features/suggestion/exposure'
import type { Suggestion } from '@/trading/features/suggestion/types'
import { armsExit } from '@/trading/features/suggestion/types'
import { floorToLot } from '@/trading/kernel/instrument'

/** The first sale on a position already held: taken when earlier sales already banked the tranche,
 *  otherwise whole lots of what is left to bank - or the plan's share alone where no lot fits. */
type HeldFirstExit =
  | { readonly kind: 'taken'; readonly soldShare: number }
  | { readonly kind: 'sell'; readonly shareOfHeld: number; readonly units?: number }

interface PlanLevels {
  readonly entry: number
  readonly stop: number
  readonly takeProfit: number
  readonly target: number
}

/** Where the first profit is taken: the take-profit when a tranche banks there, the target when the
 *  whole position leaves at once. */
export function firstExitOf(levels: PlanLevels, banked: number): number {
  return banked < 1 ? levels.takeProfit : levels.target
}

/** The R:R a reader is shown: the first exit over the stop distance, because the far target a
 *  runner aims at is reached by few entries. The void line and the reward gates keep the
 *  full-target ratio stored on the row. */
export function firstExitRiskReward(levels: PlanLevels, banked: number): number {
  const risk = Math.abs(levels.entry - levels.stop)

  return risk > 0 ? Math.abs(firstExitOf(levels, banked) - levels.entry) / risk : 0
}

/** The share a long plan banks at its take-profit, the rest riding the trail. Everything leaves at
 *  once on a reduce, a review level, a market that keeps no trail and a row that stamped no tranche: none
 *  has anything to let ride. The plan, the held exit and the outcome scorer all read this. */
export function bankedShareOf(
  suggestion: Pick<Suggestion, 'action' | 'reviewOnly' | 'takeProfitTranchePct'>,
  trails: boolean
): number {
  const tranche = suggestion.takeProfitTranchePct

  if (suggestion.action === 'reduce' || tranche === undefined || !trails || !armsExit(suggestion)) {
    return 1
  }

  return Math.min(Math.max(tranche, 0), 1)
}

/** Whether sales since the holding opened already banked the share the plan takes at its
 *  take-profit. */
export function isFirstExitTaken(
  held: Pick<HeldPosition, 'units' | 'soldUnits'>,
  plan: Pick<Suggestion, 'action' | 'reviewOnly' | 'takeProfitTranchePct'>,
  trails: boolean
): boolean {
  return heldFirstExitOf(held, bankedShareOf(plan, trails), undefined).kind === 'taken'
}

/** The tranche is a share of the position as opened, so units sold since count toward it. */
export function heldFirstExitOf(
  held: Pick<HeldPosition, 'units' | 'soldUnits'>,
  banked: number,
  lotSize: number | undefined
): HeldFirstExit {
  const sold = held.soldUnits ?? 0
  const soldShare = sold / (held.units + sold)

  if (soldShare >= banked) {
    return { kind: 'taken', soldShare }
  }

  const units = lotSize === undefined ? 0 : floorToLot(banked * (held.units + sold) - sold, lotSize)

  return units > 0
    ? { kind: 'sell', shareOfHeld: units / held.units, units }
    : { kind: 'sell', shareOfHeld: banked }
}
