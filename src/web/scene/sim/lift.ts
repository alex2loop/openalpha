import type { FloorId, LiftView } from '@/web/scene/types'
import { GROUND_FLOOR } from '@/web/scene/world/floors'
import { reducedMotion } from '@/web/state/prefs'

/** Where an empty car waits for the next call. */
const PARK_FLOOR = GROUND_FLOOR
const LIFT_PARK_MS = 30_000
const LIFT_RIDE_MS = 2_200
const LIFT_DOOR_MS = 2_000
const LIFT_DOOR_MOVE_MS = 300
// Small motion steps at about this rate while the doors move.
const DOOR_FRAME_MS = 16
// A step after a long sleep moves the doors no further than this, so they slide, never snap.
const MAX_DOOR_STEP_MS = DOOR_FRAME_MS * 4

interface Car {
  /** The floor it stands at, or rides from. */
  at: FloorId
  /** The floor it rides to; absent while it stands. */
  to: FloorId | undefined
  rideEndsAt: number
  openUntil: number
  restSince: number
  lastAt: number | undefined
  readonly called: Set<FloorId>
  readonly shown: { floor: FloorId; doors: number; called: FloorId[] }
}

/** The one lift car between the two floors: a call lights a floor's button, the car rides there
 *  and opens. Stepped with the sim; it holds no timer of its own. */
export interface Lift {
  call(floor: FloorId): void
  floorOf(): FloorId
  isOpenOn(floor: FloorId): boolean
  /** True while the doors move or the car arrives. */
  step(nowMs: number): boolean
  view(): LiftView
  /** The next moment the car changes on its own, a `performance.now()` instant. */
  nextDueAt(): number
}

export function createLift(): Lift {
  const car: Car = {
    at: PARK_FLOOR,
    to: undefined,
    rideEndsAt: 0,
    openUntil: 0,
    restSince: 0,
    lastAt: undefined,
    called: new Set(),
    shown: { floor: PARK_FLOOR, doors: 0, called: [] },
  }

  return {
    call: (floor) => {
      if (car.to === undefined && car.at === floor && car.shown.doors > 0) {
        car.openUntil = Math.max(car.openUntil, (car.lastAt ?? 0) + LIFT_DOOR_MS)
        return
      }

      if (!car.called.has(floor)) {
        car.called.add(floor)
        car.shown.called = [...car.called]
      }
    },
    floorOf: () => car.shown.floor,
    isOpenOn: (floor) => car.to === undefined && car.at === floor && car.shown.doors >= 1,
    step: (nowMs) => stepCar(car, nowMs),
    view: () => car.shown,
    nextDueAt: () => dueOf(car),
  }
}

function stepCar(car: Car, nowMs: number): boolean {
  const dtMs = nowMs - (car.lastAt ?? nowMs)

  car.lastAt = nowMs

  if (car.to !== undefined) {
    return stepRide(car, nowMs)
  }

  if (car.called.has(car.at)) {
    answer(car, car.at)
    car.openUntil = nowMs + LIFT_DOOR_MS
  }

  const isMoved = moveDoors(car, { isOpening: nowMs < car.openUntil, dtMs })

  if (car.shown.doors > 0 || nowMs < car.openUntil) {
    car.restSince = nowMs
    return isMoved
  }

  const next = otherCall(car)
  const isParking = next === undefined && car.at !== PARK_FLOOR
  const to = next ?? (isParking && nowMs - car.restSince >= LIFT_PARK_MS ? PARK_FLOOR : undefined)

  if (to !== undefined) {
    car.to = to
    car.rideEndsAt = nowMs + LIFT_RIDE_MS
  }

  return isMoved || to !== undefined
}

// The indicator turns to the next floor halfway; at the end the car stands there and opens to a
// call waiting on it.
function stepRide(car: Car, nowMs: number): boolean {
  const to = car.to ?? car.at
  const shownFloor = nowMs >= car.rideEndsAt - LIFT_RIDE_MS / 2 ? to : car.at
  const isTurned = shownFloor !== car.shown.floor

  car.shown.floor = shownFloor

  if (nowMs < car.rideEndsAt) {
    return isTurned
  }

  car.at = to
  car.to = undefined
  car.restSince = nowMs

  if (car.called.has(to)) {
    answer(car, to)
    car.openUntil = nowMs + LIFT_DOOR_MS
  }

  return true
}

function otherCall(car: Car): FloorId | undefined {
  for (const floor of car.called) {
    if (floor !== car.at) {
      return floor
    }
  }

  return undefined
}

function answer(car: Car, floor: FloorId): void {
  car.called.delete(floor)
  car.shown.called = [...car.called]
}

// The doors slide toward open or shut; reduced motion snaps them.
function moveDoors(car: Car, at: { readonly isOpening: boolean; readonly dtMs: number }): boolean {
  const goal = at.isOpening ? 1 : 0
  const held = car.shown.doors

  if (held === goal) {
    return false
  }

  const by = reducedMotion.value ? 1 : Math.min(at.dtMs, MAX_DOOR_STEP_MS) / LIFT_DOOR_MOVE_MS

  car.shown.doors = goal > held ? Math.min(goal, held + by) : Math.max(goal, held - by)

  return true
}

function dueOf(car: Car): number {
  const lastAt = car.lastAt ?? 0

  if (car.to !== undefined) {
    const half = car.rideEndsAt - LIFT_RIDE_MS / 2

    return car.shown.floor === car.at ? half : car.rideEndsAt
  }

  const isMoving = car.shown.doors > 0 && car.shown.doors < 1

  if (isMoving) {
    return lastAt + DOOR_FRAME_MS
  }

  if (car.shown.doors > 0) {
    return car.openUntil
  }

  if (car.called.size > 0) {
    return lastAt + DOOR_FRAME_MS
  }

  return car.at === PARK_FLOOR ? Number.POSITIVE_INFINITY : car.restSince + LIFT_PARK_MS
}
