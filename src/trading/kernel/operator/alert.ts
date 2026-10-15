import type { BrandTag } from '@/core/ids'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import { buildUuidV7Id, parseUuidV7Id } from '@/trading/kernel/instrument'

/** A price alert's identity and the one thing it tests. Kernel vocabulary because three modules
 *  outside the feature speak it: the slash surface parses an id, the notice envelope carries a
 *  delivering alert, and the brief renderer prints a condition. */
export type AlertId = string & BrandTag<'AlertId'>

export function alertId(raw: string): AlertId {
  return parseUuidV7Id<AlertId>(raw, 'AlertId')
}

export function buildAlertId(now: number): AlertId {
  return buildUuidV7Id<AlertId>(now, 'AlertId')
}

export const ALERT_CONDITIONS = Object.freeze(['above', 'below'] as const)
export type AlertCondition = (typeof ALERT_CONDITIONS)[number]

/** What is known about this holding's stop. `none`: no plan, or a plan with no stop. `distance`:
 *  the level the latest plan set, measured against the mark when one was available. */
type StopPlanState = 'none' | 'distance'

/** A held name against the stop its latest plan set, and how far the mark sits from it. The level a
 *  plan intends, never one standing at an exchange — a position can carry this and have no resting
 *  order behind it, which is why the row that prints it says so. Kernel vocabulary for the same
 *  reason `AlertCondition` is: the alert stack derives it, the portfolio renders it per row, and the
 *  brief counts it. */
export interface StopDistance {
  readonly instrument: InstrumentRef
  readonly plan: StopPlanState
  readonly stop?: number
  readonly takeProfit?: number
  readonly distanceToStopPct?: number
  /** The mark `distanceToStopPct` was measured from; absent when the holding has no price. */
  readonly price?: number
  /** A fund's lower level is a review, not a sale: the book words it "review" rather than "stop". */
  readonly review: boolean
}

/** Who stands behind a held name's stop at an exchange this tree can place on: an exit it placed,
 *  one the operator set in the exchange's own app, or none. Only the first can be moved from here. */
export type StopCover = 'placed' | 'venue' | 'none'

/** Where a holding stands against its own planned stop. `unmeasured` is the arm a counter must not
 *  fold away: no plan, or a holding the watch never priced. Kernel vocabulary because the book's
 *  rows and the brief's tally must not each own the comparison. */
type StopStanding = 'breached' | 'clear' | 'unmeasured'

export function stopStandingOf(distance: StopDistance): StopStanding {
  const pct = distance.plan === 'distance' ? distance.distanceToStopPct : undefined

  if (pct === undefined) {
    return 'unmeasured'
  }

  return pct <= 0 ? 'breached' : 'clear'
}

/** A stop this close to the mark is one the operator should look at today. Kernel vocabulary
 *  because the book's attention line and a fresh plan's levels ask the same question, and two
 *  thresholds would let one surface call a stop urgent while the other printed it as routine. */
const STOP_PROXIMITY_FRACTION = 0.03

/** Whether the mark sits within that fraction of the stop. False for a stop already through, which
 *  is a different state with its own wording on every surface that reports it. */
export function isNearStop(distanceToStopPct: number): boolean {
  return distanceToStopPct > 0 && distanceToStopPct <= STOP_PROXIMITY_FRACTION
}
