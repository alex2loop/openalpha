import type { createRng } from '@/web/scene/world/rng'
import { PAVEMENT, WALK_REACH_PX } from '@/web/scene/sim/street/ped-walk'
import { WORLD } from '@/web/scene/types'

// The flower bicycle: its line along the far kerb, pace, the chance a step sets it off, the stops
// it makes and how often, and the px of road per pedal frame.
const BIKE = Object.freeze({
  y: PAVEMENT.farKerb - 0.2,
  pxPerS: 5.2,
  chance: 0.001,
  stopMs: { min: 6_000, span: 8_000 },
  gapMs: { min: 25_000, span: 40_000 },
  firstStopMs: { min: 8_000, span: 30_000 },
  pxPerFrame: 1.1,
})
const PEDAL_FRAMES = 2

type Rng = ReturnType<typeof createRng>

/** The flower seller's bicycle, written only by the street sim. */
export interface Bike {
  on: boolean
  readonly prev: { x: number; y: number }
  readonly at: { x: number; y: number }
  facing: -1 | 1
  frame: number
  dist: number
  stopUntil: number
  nextStopAt: number
}

/** What a bicycle step reads: the chance, whether its hours hold, sim time and seconds stepped. */
interface BikeStep {
  readonly rng: Rng
  readonly isOpen: boolean
  readonly nowMs: number
  readonly dt: number
}

export function createBike(): Bike {
  return {
    on: false,
    prev: { x: 0, y: BIKE.y },
    at: { x: 0, y: BIKE.y },
    facing: 1,
    frame: 0,
    dist: 0,
    stopUntil: 0,
    nextStopAt: 0,
  }
}

/** While its hours hold, the bicycle stands at a stop somewhere along the far kerb. */
export function placeBike(bike: Bike, at: Omit<BikeStep, 'dt'>): void {
  const { rng } = at

  bike.on = at.isOpen
  bike.facing = rng.next() < 0.5 ? 1 : -1
  bike.at.x = rng.next() * WORLD.w
  bike.prev.x = bike.at.x
  bike.frame = 0
  bike.stopUntil = at.nowMs + BIKE.stopMs.min + rng.next() * BIKE.stopMs.span
  bike.nextStopAt = bike.stopUntil + BIKE.gapMs.min + rng.next() * BIKE.gapMs.span
}

/** Sets off from one end now and then while its hours hold; rides slowly, stops, rides on, and
 *  is gone past the other end. */
export function stepBike(bike: Bike, step: BikeStep): void {
  const { rng } = step

  bike.prev.x = bike.at.x

  if (!bike.on) {
    if (step.isOpen && rng.next() < BIKE.chance) {
      startBike(bike, step)
    }

    return
  }

  if (step.nowMs < bike.stopUntil) {
    bike.frame = 0
    return
  }

  bike.at.x += bike.facing * BIKE.pxPerS * step.dt
  bike.dist += BIKE.pxPerS * step.dt
  bike.frame = Math.floor(bike.dist / BIKE.pxPerFrame) % PEDAL_FRAMES

  if (step.nowMs > bike.nextStopAt) {
    bike.stopUntil = step.nowMs + BIKE.stopMs.min + rng.next() * BIKE.stopMs.span
    bike.nextStopAt = bike.stopUntil + BIKE.gapMs.min + rng.next() * BIKE.gapMs.span
  }

  bike.on = bike.at.x > -WALK_REACH_PX && bike.at.x < WORLD.w + WALK_REACH_PX
}

function startBike(bike: Bike, at: BikeStep): void {
  const { rng } = at

  bike.on = true
  bike.facing = rng.next() < 0.5 ? 1 : -1
  bike.at.x = bike.facing > 0 ? -WALK_REACH_PX + 1 : WORLD.w + WALK_REACH_PX - 1
  bike.prev.x = bike.at.x
  bike.dist = 0
  bike.stopUntil = 0
  bike.nextStopAt = at.nowMs + BIKE.firstStopMs.min + rng.next() * BIKE.firstStopMs.span
}
