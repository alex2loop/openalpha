import type { Vehicle } from '@/web/scene/sim/street/flows'
import { sheltersOf } from '@/web/scene/sim/street/flows'
import {
  addPoint,
  clearRoute,
  countOf,
  countTask,
  PAVEMENT,
  type Ped,
  type PedStep,
  type Peds,
  startOn,
  takePed,
  WALK_PACE,
  WALK_REACH_PX,
} from '@/web/scene/sim/street/ped-walk'
import { spawn } from '@/web/scene/sim/street/spawn'
import { isWithin } from '@/web/scene/sim/street/traffic'
import { WORLD } from '@/web/scene/types'
import { isShopOpen, type RegionPack, shopDoorOf } from '@/web/scene/world/regions'
import { NORTH } from '@/web/scene/world/street-layout'
import { MS_PER_SECOND } from '@/web/text/time-units'

// The chance a step adds one more of each, when one is due.
const CHANCES = Object.freeze({ waiter: 0.006, school: 0.012, cafe: 0.008 })
// Waiting spots either side of a shelter's middle, how full they start, how far along the
// pavement a new waiter comes from, and how far into the road the waiters step to board.
const WAIT_SPOTS = [-5, 1, 6] as const
const WAIT_Y = Object.freeze({ far: NORTH.roadTop - 2.3, near: NORTH.roadBottom + 3.2 })
const WAIT_SEED_SHARE = 0.6
const WAIT_FROM_PX = Object.freeze({ min: 34, span: 30 })
const BOARD_REACH_PX = 14
const BOARD_Y = Object.freeze({ far: NORTH.roadTop + 2.6, near: NORTH.roadBottom - 2.4 })
// School out: the gate, groups of 2 to 4, at most 8 out, and the share a parent picks up.
const SCHOOL_GATE = Object.freeze({ x: 540, y: NORTH.farTop - 0.4 })
const GROUP = Object.freeze({ min: 2, span: 3, spread: 5, step: 8 })
const MAX_PUPILS = 8
const PUPIL_PX_PER_S = 3.2
const PICKUP_SHARE = 0.55
const PICKUP_SPREAD_PX = 32
const PICKUP_REACH_PX = 4
// A delivery handed over at a shop door: the wait at the kerb.
const HANDOVER_MS = 2_600
// The café: its seats either side of its door, at most 3 taken, each for 30 to 140 s.
const CAFE_SEATS = [-12.2, -5.8, 5.8, 12.2] as const
const CAFE_SEAT_Y = PAVEMENT.far - 0.8
const CAFE_MAX = 3
const CAFE_STAY_MS = Object.freeze({ min: 30_000, span: 110_000 })
const CAFE_WALK_FROM_PX = 70
const CAFE_CUP_SHARE = 0.6

/** The clock's due scenes: a waiter now and then outside the night, pupils out of school, a
 *  sitter at the café, someone out to every delivery that stopped. */
export function scheduleScenes(peds: Peds, at: PedStep): void {
  const { pack } = at.traffic
  const { hours } = pack
  const { rng } = peds

  if (!isWithin(hours.night, at.minute) && rng.next() < CHANCES.waiter) {
    arriveWaiter(peds, { pack, nowMs: at.nowMs })
  }

  if (
    isWithin(hours.school, at.minute) &&
    countOf(peds, 'pupil') < MAX_PUPILS &&
    rng.next() < CHANCES.school
  ) {
    schoolOut(peds, at)
  }

  if (
    isWithin(hours.cafe, at.minute) &&
    countTask(peds, 'sit') < CAFE_MAX &&
    rng.next() < CHANCES.cafe
  ) {
    arriveSitter(peds, at)
  }

  serveDeliveries(peds, at)
}

// At the route's end: a waiter takes the spot, a sitter the seat, a receiver waits for the bag
// then goes back in; everyone else leaves the street.
export function arrive(peds: Peds, ped: Ped, nowMs: number): void {
  if (ped.spot >= 0 && ped.task === 'walk' && ped.kind === 'waiter') {
    ped.task = 'wait'
    ped.facing = 'south'
    return
  }

  if (ped.task === 'sit' && ped.kind !== 'sitter') {
    ped.kind = 'sitter'
    ped.facing = ped.spot % 2 === 0 ? 'east' : 'west'
    ped.holdUntil = nowMs + CAFE_STAY_MS.min + peds.rng.next() * CAFE_STAY_MS.span
    ped.item = peds.rng.next() < CAFE_CUP_SHARE ? 'cup' : undefined
    clearRoute(ped)
    return
  }

  if (ped.task === 'receive' && ped.item === undefined) {
    ped.item = 'bag'
    ped.holdUntil = nowMs + HANDOVER_MS
    ped.facing = 'north'
    clearRoute(ped)
    addPoint(ped, ped.at.x, PAVEMENT.door)
    return
  }

  if (ped.task !== 'pickup') {
    ped.on = false
  }
}

export function seedWaiters(
  peds: Peds,
  at: { readonly pack: RegionPack; readonly nowMs: number }
): void {
  for (const [index, spot] of spotsOf(at.pack).entries()) {
    const ped = peds.rng.next() < WAIT_SEED_SHARE ? takePed(peds, spot) : undefined

    if (ped !== undefined) {
      ped.kind = 'waiter'
      ped.task = 'wait'
      ped.spot = index
      ped.facing = 'south'
      ped.movedAt = at.nowMs - MS_PER_SECOND
    }
  }
}

// Someone new walks along the pavement to a free spot at a shelter and waits there.
function arriveWaiter(peds: Peds, at: { readonly pack: RegionPack; readonly nowMs: number }): void {
  const spots = spotsOf(at.pack)
  const index = peds.rng.int(0, spots.length - 1)
  const spot = spots[index]
  const ped = spot === undefined || isSpotTaken(peds, index) ? undefined : takePed(peds, spot)

  if (spot === undefined || ped === undefined) {
    return
  }

  const from =
    spot.x +
    (peds.rng.next() < 0.5 ? -1 : 1) * (WAIT_FROM_PX.min + peds.rng.next() * WAIT_FROM_PX.span)

  ped.kind = 'waiter'
  ped.spot = index
  addPoint(ped, from, spot.y)
  addPoint(ped, spot.x, spot.y)
  startOn(peds, ped, { nowMs: at.nowMs, isPlaced: false })
}

// Every shelter's waiting spots and the stop each one boards at, built once per pack.
const SPOTS_BY_PACK = new WeakMap<RegionPack, readonly WaitSpot[]>()

interface WaitSpot {
  readonly x: number
  readonly y: number
  readonly stop: number
}

function spotsOf(pack: RegionPack): readonly WaitSpot[] {
  const held = SPOTS_BY_PACK.get(pack)

  if (held !== undefined) {
    return held
  }

  const spots = sheltersOf(pack).flatMap((shelter) =>
    WAIT_SPOTS.map((offset) => ({
      x: shelter.x + offset,
      y: shelter.stop.side === 'far' ? WAIT_Y.far : WAIT_Y.near,
      stop: shelter.x,
    }))
  )

  SPOTS_BY_PACK.set(pack, spots)

  return spots
}

function isSpotTaken(peds: Peds, spot: number): boolean {
  return peds.pool.some((ped) => ped.on && ped.kind === 'waiter' && ped.spot === spot)
}

// A bus dwelling at the waiter's own stop: they step to its door and are gone with it.
export function boardIfDue(
  ped: Ped,
  at: { readonly pool: readonly Vehicle[]; readonly pack: RegionPack }
): void {
  const spot = spotsOf(at.pack)[ped.spot]

  for (const bus of at.pool) {
    const isBoarding =
      bus.on &&
      bus.kind === 'bus' &&
      bus.dwellUntil > 0 &&
      bus.stops[bus.stopIndex] === spot?.stop &&
      Math.abs(bus.pos - ped.at.x) < BOARD_REACH_PX

    if (isBoarding) {
      ped.task = 'walk'
      ped.kind = 'walker'
      clearRoute(ped)
      addPoint(ped, ped.at.x, ped.at.y < bus.at.y ? BOARD_Y.far : BOARD_Y.near)
      return
    }
  }
}

// A group of pupils out of the gate; with a parent coming, the first waits at the kerb for the
// scooter, the rest walk off together.
function schoolOut(peds: Peds, at: PedStep): void {
  const { rng } = peds
  const count = GROUP.min + Math.floor(rng.next() * GROUP.span)
  const dir = rng.next() < 0.5 ? -1 : 1
  const parent = rng.next() < PICKUP_SHARE ? parentFor(peds, at) : undefined

  for (let index = 0; index < count; index++) {
    const x = SCHOOL_GATE.x + (rng.next() - 0.5) * GROUP.spread
    const ped = takePed(peds, { x, y: SCHOOL_GATE.y })

    if (ped === undefined) {
      return
    }

    ped.kind = 'pupil'
    ped.speed = PUPIL_PX_PER_S * (WALK_PACE.from + rng.next() * WALK_PACE.span)

    if (index === 0 && parent !== undefined) {
      ped.task = 'pickup'
      ped.vehicle = parent
      addPoint(ped, parent.stops[0] ?? x, PAVEMENT.farKerb)
    } else {
      addPoint(ped, x + dir * GROUP.step, PAVEMENT.far)
      addPoint(ped, dir > 0 ? WORLD.w + WALK_REACH_PX : -WALK_REACH_PX, PAVEMENT.far)
    }
  }
}

// The parent's scooter on the far way, stopping at a kerb spot by the gate.
function parentFor(peds: Peds, at: PedStep): Vehicle | undefined {
  const { flows } = at.traffic
  const flow = flows.north.find((way) => way.dir < 0) ?? flows.north[0]
  const spot = SCHOOL_GATE.x + (peds.rng.next() - 0.5) * PICKUP_SPREAD_PX
  const bike = spawn(at.traffic, { flow, kind: 'motorbike', stops: [spot] })

  if (bike !== undefined) {
    bike.passenger = false
  }

  return bike
}

// The pupil climbs on once the scooter stops beside them; if it left, they walk off.
export function hopOn(ped: Ped): boolean {
  const bike = ped.vehicle
  const stop = bike?.stops[0]

  if (bike === undefined || stop === undefined) {
    return false
  }

  if (bike.on && bike.dwellUntil > 0 && Math.abs(bike.pos - ped.at.x) < PICKUP_REACH_PX) {
    bike.kind = 'school'
    bike.passenger = true
    ped.on = false
    return true
  }

  if (!bike.on || bike.stopIndex > 0) {
    ped.task = 'walk'
    ped.vehicle = undefined
    clearRoute(ped)
    addPoint(ped, -WALK_REACH_PX, PAVEMENT.far)
  }

  return false
}

// A rider stopped at a shop: someone steps out of the door to the kerb, takes the bag and goes
// back in.
function serveDeliveries(peds: Peds, at: PedStep): void {
  for (const vehicle of at.traffic.pool) {
    const isWaiting = vehicle.on && vehicle.kind === 'delivery' && vehicle.dwellUntil > 0

    if (isWaiting && !isServed(peds, vehicle)) {
      const ped = takePed(peds, { x: vehicle.pos, y: PAVEMENT.door })

      if (ped !== undefined) {
        ped.kind = 'receiver'
        ped.task = 'receive'
        ped.vehicle = vehicle
        addPoint(ped, vehicle.pos, PAVEMENT.farKerb)
      }
    }
  }
}

function isServed(peds: Peds, vehicle: Vehicle): boolean {
  for (const ped of peds.pool) {
    if (ped.on && ped.vehicle === vehicle) {
      return true
    }
  }

  return false
}

// Someone walks along the far pavement to a free café seat and sits a while.
function arriveSitter(peds: Peds, at: PedStep): void {
  const door = cafeDoorOf(at.traffic.pack, at.minute)
  const seat = peds.rng.int(0, CAFE_SEATS.length - 1)
  const offset = CAFE_SEATS[seat]

  if (door === undefined || offset === undefined || isSeatTaken(peds, seat)) {
    return
  }

  const side = offset < 0 ? -1 : 1
  const ped = takePed(peds, { x: door.x + side * CAFE_WALK_FROM_PX, y: PAVEMENT.far })

  if (ped !== undefined) {
    ped.task = 'sit'
    ped.spot = seat
    addPoint(ped, ped.at.x, PAVEMENT.far)
    addPoint(ped, door.x + offset, CAFE_SEAT_Y)
    startOn(peds, ped, { nowMs: at.nowMs, isPlaced: false })
  }
}

// The open café nearest the crossing.
function cafeDoorOf(pack: RegionPack, minute: number): { readonly x: number } | undefined {
  let best: { readonly x: number } | undefined

  for (const [index, row] of pack.shops.entries()) {
    if (row.kind === 'cafe' && isShopOpen(row, minute)) {
      const door = shopDoorOf(pack.shops, index)

      if (best === undefined || Math.abs(door.x) < Math.abs(best.x)) {
        best = door
      }
    }
  }

  return best
}

function isSeatTaken(peds: Peds, seat: number): boolean {
  return peds.pool.some((ped) => ped.on && ped.task === 'sit' && ped.spot === seat)
}

export function leaveSeat(ped: Ped): void {
  ped.kind = 'walker'
  ped.task = 'walk'
  ped.item = undefined
  addPoint(ped, ped.at.x, PAVEMENT.far)
  addPoint(ped, ped.facing === 'east' ? WORLD.w + WALK_REACH_PX : -WALK_REACH_PX, PAVEMENT.far)
}
