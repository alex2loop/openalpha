import {
  addPoint,
  clearRoute,
  countTask,
  PAVEMENT,
  type Ped,
  type PedStep,
  type Peds,
  startOn,
  takePed,
} from '@/web/scene/sim/street/ped-walk'
import { isShopOpen, isWithin, type RegionPack, shopDoorOf } from '@/web/scene/world/regions'

// Through lunch a walker joins a food shop's queue this often a step, at most at this many shops
// at once. The queue stands a little out from the door, each place a step further east; the
// first in line waits this long, each one behind a little longer, then goes in.
const QUEUE_CHANCE = 0.02
const QUEUE_SHOPS = 2
const QUEUE_Y = PAVEMENT.door + 4.2
const QUEUE_STEP_PX = 3.6
const QUEUE_FROM_PX = 60
const QUEUE_MS = Object.freeze({ first: 18_000, each: 14_000, span: 6_000 })
const SEED_SHARE = 0.7
// A queuer's `spot` is its shop's index times this plus its place in line; no queue is longer.
const QUEUE_PLACES_MAX = 8
// Inside the door: halfway between the queue's line and the door.
const DOOR_LINE = (PAVEMENT.door + QUEUE_Y) / 2

/** Through the pack's lunch hour a walker comes along the far pavement and joins the queue at an
 *  open food shop's door, behind whoever is already there. */
export function scheduleQueue(peds: Peds, at: PedStep): void {
  const { pack } = at.traffic

  if (!isWithin(pack.hours.lunch, at.minute) || peds.rng.next() >= QUEUE_CHANCE) {
    return
  }

  const shops = queueShopsOf(pack, at.minute)
  const shop = shops.length === 0 ? undefined : shops[peds.rng.int(0, shops.length - 1)]
  const place = shop === undefined ? -1 : nextPlace(peds, { pack, shop })

  if (shop === undefined || place < 0) {
    return
  }

  const door = shopDoorOf(pack.shops, shop)
  const spotX = door.x + place * QUEUE_STEP_PX
  const side = peds.rng.next() < 0.5 ? -1 : 1
  const ped = takePed(peds, { x: spotX + side * QUEUE_FROM_PX, y: PAVEMENT.far })

  if (ped !== undefined) {
    ped.task = 'queue'
    ped.spot = shop * QUEUE_PLACES_MAX + place
    addPoint(ped, ped.at.x, PAVEMENT.far)
    addPoint(ped, spotX, PAVEMENT.far)
    addPoint(ped, spotX, QUEUE_Y)
    startOn(peds, ped, { nowMs: at.nowMs, isPlaced: false })
  }
}

/** The lunch queues as the clock finds them: most places at the queued shops already taken. */
export function seedQueues(
  peds: Peds,
  at: { readonly pack: RegionPack; readonly minute: number; readonly nowMs: number }
): void {
  if (!isWithin(at.pack.hours.lunch, at.minute)) {
    return
  }

  for (const shop of queueShopsOf(at.pack, at.minute)) {
    const door = shopDoorOf(at.pack.shops, shop)

    for (let place = 0; place < queueLengthOf(at.pack); place++) {
      const ped =
        peds.rng.next() < SEED_SHARE
          ? takePed(peds, { x: door.x + place * QUEUE_STEP_PX, y: QUEUE_Y })
          : undefined

      if (ped !== undefined) {
        ped.task = 'queue'
        ped.spot = shop * QUEUE_PLACES_MAX + place
        standInLine(peds, ped, at.nowMs)
      }
    }
  }
}

/** A queuer at the end of a leg: in line it faces the door and waits its turn, then walks in;
 *  at the door it is gone. False for anyone else. */
export function arriveInQueue(peds: Peds, ped: Ped, nowMs: number): boolean {
  if (ped.task !== 'queue') {
    return false
  }

  if (ped.at.y < DOOR_LINE) {
    ped.on = false
  } else {
    standInLine(peds, ped, nowMs)
  }

  return true
}

function standInLine(peds: Peds, ped: Ped, nowMs: number): void {
  const place = ped.spot % QUEUE_PLACES_MAX

  ped.facing = 'north'
  ped.movedAt = nowMs
  ped.holdUntil = nowMs + QUEUE_MS.first + place * QUEUE_MS.each + peds.rng.next() * QUEUE_MS.span
  clearRoute(ped)
  addPoint(ped, ped.at.x, PAVEMENT.door)
}

// The open food shops that may hold a queue: the first few along the row, so the same doors
// queue through the hour.
function queueShopsOf(pack: RegionPack, minute: number): number[] {
  return pack.shops
    .flatMap((row, index) => (row.kind === 'food' && isShopOpen(row, minute) ? [index] : []))
    .slice(0, QUEUE_SHOPS)
}

// The place behind the last one taken at `shop`, or -1 when its queue is full.
function nextPlace(peds: Peds, at: { readonly pack: RegionPack; readonly shop: number }): number {
  const length = queueLengthOf(at.pack)

  if (countTask(peds, 'queue') >= length * QUEUE_SHOPS) {
    return -1
  }

  let next = 0

  for (const ped of peds.pool) {
    if (ped.on && ped.task === 'queue' && Math.floor(ped.spot / QUEUE_PLACES_MAX) === at.shop) {
      next = Math.max(next, (ped.spot % QUEUE_PLACES_MAX) + 1)
    }
  }

  return next < length ? next : -1
}

function queueLengthOf(pack: RegionPack): number {
  return Math.min(pack.crowd.lunchQueue, QUEUE_PLACES_MAX)
}
