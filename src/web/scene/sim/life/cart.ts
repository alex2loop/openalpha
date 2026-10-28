import type { LifeState, LifeStep } from '@/web/scene/sim/life/state'
import type { FloorId, Point, Rect } from '@/web/scene/types'
import type { OfficeLife } from '@/web/scene/world/regions'
import type { ClockParts } from '@/web/text/time'
import { BLOCK_FLOOR, setBlock } from '@/web/scene/sim/life/blocks'
import { PANTRY } from '@/web/scene/world/seats'

/** The floor the cart serves: the one with the office's staff and its pantry. */
export const CART_FLOOR: FloorId = BLOCK_FLOOR
const CART_ROLL_MS = 6_000
// The cart's footprint on the floor, centred on where it stands.
const CART_SIZE = Object.freeze({ w: 20, h: 10 })

/** The clock falls within the dessert cart's stay. */
export function isCartStay(clock: ClockParts, dessert: OfficeLife['dessert']): boolean {
  const sinceMin = clock.minute - dessert.at

  return clock.dow === dessert.dow && sinceMin >= 0 && sinceMin < dessert.stayMin
}

/** Friday's dessert cart: it rolls in along its path when its stay begins, stands in the pantry
 *  (in everyone's way, so walks go round it) and rolls out when the stay ends. A page opened
 *  mid-stay finds it standing; reduced motion never rolls it. True while it rolls. */
export function stepCart(state: LifeState, step: LifeStep): boolean {
  const { cart } = state
  const sinceMin = step.clock.minute - step.pack.dessert.at
  const isStay = isCartStay(step.clock, step.pack.dessert)

  startRoll(cart, { isStay, isArriving: sinceMin < 1, step })

  if (!(isStay || cart.isLeaving)) {
    cart.at = undefined
    blockAt(state, undefined)

    return false
  }

  const { path, rest } = PANTRY[CART_FLOOR].cart
  const k =
    cart.rollFrom === undefined ? 1 : Math.min(1, (step.nowMs - cart.rollFrom) / CART_ROLL_MS)
  const isGone = cart.isLeaving && k >= 1
  const isStanding = !cart.isLeaving && k >= 1

  cart.at = isGone ? undefined : pointAlong(cart.isLeaving ? [...path].reverse() : path, k)
  cart.rollFrom = k >= 1 ? undefined : cart.rollFrom
  cart.isLeaving = cart.isLeaving && !isGone
  blockAt(state, isStanding ? rest : undefined)

  return cart.rollFrom !== undefined
}

// Its stay begins: it rolls in only when the page sees the first minute of it, else it stands
// there already. Its stay ends: it rolls out. Reduced motion or office hours over: no roll.
function startRoll(
  cart: LifeState['cart'],
  at: { readonly isStay: boolean; readonly isArriving: boolean; readonly step: LifeStep }
): void {
  const rollFrom = at.step.canWalk ? at.step.nowMs : undefined

  if (at.isStay && cart.at === undefined) {
    cart.isLeaving = false
    cart.rollFrom = at.isArriving ? rollFrom : undefined
  } else if (!at.isStay && cart.at !== undefined && !cart.isLeaving) {
    cart.isLeaving = true
    cart.rollFrom = rollFrom
  }
}

function blockAt(state: LifeState, at: Point | undefined): void {
  const isBlocking = at !== undefined

  if (isBlocking === state.cart.isBlocking) {
    return
  }

  state.cart.isBlocking = isBlocking
  setBlock(state, 'cart', at === undefined ? undefined : footprintOf(at))
}

function footprintOf(at: Point): Rect {
  return { x: at.x - CART_SIZE.w / 2, y: at.y - CART_SIZE.h, w: CART_SIZE.w, h: CART_SIZE.h }
}

// The point `k` of the way along the polyline, by length.
function pointAlong(path: readonly Point[], k: number): Point | undefined {
  const legs = path.slice(1).map((to, i) => ({ from: path[i] ?? to, to }))
  const total = legs.reduce(
    (sum, leg) => sum + Math.hypot(leg.to.x - leg.from.x, leg.to.y - leg.from.y),
    0
  )
  let left = k * total

  for (const leg of legs) {
    const length = Math.hypot(leg.to.x - leg.from.x, leg.to.y - leg.from.y)

    if (left <= length && length > 0) {
      const u = left / length

      return {
        x: leg.from.x + (leg.to.x - leg.from.x) * u,
        y: leg.from.y + (leg.to.y - leg.from.y) * u,
      }
    }

    left -= length
  }

  return path.at(-1)
}
