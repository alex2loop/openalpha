import type { Errands } from '@/web/scene/sim/street/errands'
import type { Goal } from '@/web/scene/sim/vocabulary'
import type { ErrandItem, ErrandShop } from '@/web/scene/street-types'
import type { ActorId } from '@/web/scene/types'
import {
  addCrossing,
  addPoint,
  clearRoute,
  PAVEMENT,
  type Ped,
  type PedStep,
  placePed,
  SIDE_WALKS,
  syncGait,
  syncWalkTick,
  walkPed,
} from '@/web/scene/sim/street/ped-walk'
import { SEAT_TARGET } from '@/web/scene/sim/vocabulary'
import { STREET_DOOR } from '@/web/scene/world/doors'
import { isShopOpen, type RegionPack, shopDoorOf } from '@/web/scene/world/regions'

// Outside an errand walks this many px a second and stays at the counter this long.
const ERRAND_WALK_PX = 20
const BUY_MS = 14_000
// An errand may start over the crossing until this long before the cars' green.
const CROSS_LEAD_MS = 3_000
// The queue: the first spot this far out from the door, then one every 3.4 px.
const QUEUE = Object.freeze({ fromDoor: 1.8, gap: 3.4 })
/** The side pavement errands walk, the crossing's line. */
export const CROSSING_X = -SIDE_WALKS.near

type Phase = 'leaving' | 'going' | 'queue' | 'buying' | 'back' | 'entering'

/** One errand slot: who, to which shop and for what, where the trip stands, the goals it gave the
 *  director, its clocks, the person's own pace, and the person the street draws while out. */
export interface Errand {
  on: boolean
  actor: ActorId
  shop: number
  kind: ErrandShop
  item: ErrandItem
  phase: Phase
  hasItem: boolean
  seatPose: 'sit' | 'idle'
  doorGoal: Goal | undefined
  goal: Goal | undefined
  since: number
  outAt: number
  buyUntil: number
  speed: number
  readonly ped: Ped
}

/** Past the street door and not back in yet. */
export function isOutside(errand: Errand): boolean {
  return errand.phase !== 'leaving' && errand.phase !== 'entering'
}

// At the street door: off the floor and onto the street, up to the crossing.
export function goOut(errand: Errand, nowMs: number): void {
  const { ped } = errand
  const staff = ped.staff

  placePed(ped, STREET_DOOR)
  ped.kind = 'staff'
  ped.staff = staff
  ped.speed = ERRAND_WALK_PX
  ped.movedAt = nowMs
  addPoint(ped, CROSSING_X, STREET_DOOR.y)
  addPoint(ped, CROSSING_X, PAVEMENT.nearKerb)
  addCrossing(ped, CROSSING_X, PAVEMENT.farKerb)
  addPoint(ped, CROSSING_X, PAVEMENT.far)
  errand.phase = 'going'
  errand.outAt = nowMs
}

/** The street side, once a sim step: the walk out, the queue and the counter, and the walk back
 *  to the street door, where the floor takes them again. True when someone came back in. */
export function stepErrandsStreet(errands: Errands, step: PedStep): boolean {
  let hasCome = false

  syncWalkTick(errands.tick, step, CROSS_LEAD_MS)

  for (const errand of errands.slots) {
    if (errand.on && isOutside(errand)) {
      stepStreet(errands, errand, step)
      syncGait(errand.ped, step.nowMs)
      hasCome = hasCome || errand.phase === 'entering'
    }
  }

  return hasCome
}

function stepStreet(errands: Errands, errand: Errand, step: PedStep): void {
  const { nowMs } = step
  const { pack } = step.traffic
  const { ped } = errand
  const row = pack.shops[errand.shop]
  const isOpen = row !== undefined && isShopOpen(row, step.minute)
  const isArrived = walkPed(ped, errands.tick)

  if (isAtCounter(errand) && !isOpen) {
    turnBack(errand)
  } else if (errand.phase === 'going' && isArrived) {
    toCounter(errands, errand, pack)
  } else if (errand.phase === 'queue' && isArrived) {
    errand.phase = 'buying'
    errand.buyUntil = nowMs + BUY_MS
    ped.facing = 'north'
  } else if (errand.phase === 'buying' && nowMs >= errand.buyUntil) {
    errand.hasItem = true
    ped.item = errand.item
    turnBack(errand)
  } else if (errand.phase === 'back' && isArrived) {
    comeIn(errands, errand, nowMs)
  }
}

// Along the far pavement to the shop, then to the spot behind whoever queues there already.
function toCounter(errands: Errands, errand: Errand, pack: RegionPack): void {
  const { ped } = errand
  const door = shopDoorOf(pack.shops, errand.shop)
  const isAtShop = Math.abs(ped.at.x - door.x) < QUEUE.gap
  const ahead = errands.slots.filter(
    (other) => other !== errand && other.on && other.shop === errand.shop && isAtCounter(other)
  ).length

  clearRoute(ped)
  addPoint(ped, door.x, isAtShop ? door.y + QUEUE.fromDoor + ahead * QUEUE.gap : PAVEMENT.far)
  errand.phase = isAtShop ? 'queue' : 'going'
}

function isAtCounter(errand: Errand): boolean {
  return errand.phase === 'queue' || errand.phase === 'buying'
}

// Back to the street door from wherever they stand: to the crossing, over on the walk signal,
// and down the side pavement.
export function turnBack(errand: Errand): void {
  const { ped } = errand

  clearRoute(ped)

  if (ped.at.y <= PAVEMENT.farKerb) {
    addPoint(ped, ped.at.x, PAVEMENT.far)
    addPoint(ped, CROSSING_X, PAVEMENT.far)
    addPoint(ped, CROSSING_X, PAVEMENT.farKerb)
    addCrossing(ped, CROSSING_X, PAVEMENT.nearKerb)
  } else if (ped.at.y < PAVEMENT.nearKerb) {
    addPoint(ped, CROSSING_X, PAVEMENT.nearKerb)
  }

  addPoint(ped, CROSSING_X, STREET_DOOR.y)
  addPoint(ped, STREET_DOOR.x, STREET_DOOR.y)
  errand.phase = 'back'
}

// Through the street door and back to the seat, with the item in hand.
function comeIn(errands: Errands, errand: Errand, nowMs: number): void {
  const actor = errand.actor
  const item = errand.hasItem ? errand.item : undefined

  errand.ped.on = false
  errand.phase = 'entering'
  errand.since = nowMs
  errand.goal = {
    kind: 'life',
    target: SEAT_TARGET,
    pose: errand.seatPose,
    since: nowMs,
    ...(item === undefined ? {} : { item }),
  }
  errands.host.setLife(actor, errand.goal)
}
