import type { Critter, CritterStep, Critters } from '@/web/scene/sim/street/critters'
import type { VehicleView } from '@/web/scene/street-types'
import type { RegionPack } from '@/web/scene/world/regions'
import {
  beatOf,
  flip,
  rest,
  type Span,
  WALK_FRAMES,
  walkTo,
} from '@/web/scene/sim/street/critter-moves'
import { WORLD } from '@/web/scene/types'
import { shopRowSpanOf } from '@/web/scene/world/frontage'
import { FAR_TREE_Y, FAR_TREES } from '@/web/scene/world/street-layout'

/** Two flocks of two on the far kerb, clear of the shop doors, the shelters and the crossing. */
export const PIGEON_HOMES = [
  { x: 118, y: -19.9, flock: 0 },
  { x: 126, y: -20.7, flock: 0 },
  { x: 337, y: -20.5, flock: 1 },
  { x: 345, y: -19.8, flock: 1 },
] as const
/** The sparrows: how many, the pavement under their trees, and how high they perch. */
export const SPARROWS = Object.freeze({ count: 3, groundY: FAR_TREE_Y + 0.7, perchLift: 9 })
// A pigeon wanders this far round its home; a walker this close (y counted 1.4 times) or a
// vehicle this close on the kerb lane takes the flock up, staggered, away from it, for a while.
const PIGEON = Object.freeze({
  pxPerS: 3.6,
  wander: 24,
  scare: 5,
  vehicle: { dx: 6, dy: 5 },
  flyMs: 2_400,
  flyPxPerS: 14,
  risePxPerS: 6,
  awayMs: { min: 14_000, span: 16_000 },
  landMs: 1_700,
  landFrom: 20,
  landLift: 10,
  staggerMs: 130,
  bobPx: 0.6,
})
// A sparrow drops from its perch to the pavement under it, hops and pecks a while within `reach`,
// and flies back up; a walker this close sends it back up at once.
const SPARROW = Object.freeze({
  flutterLift: 2.2,
  dropMs: 700,
  hopMs: 330,
  hopLift: 1.3,
  hopPx: { min: 1.2, span: 1.4 },
  hopShare: 0.78,
  reach: 4.5,
  groundMs: { min: 9_000, span: 7_000 },
  perchMs: { min: 1_500, span: 3_500 },
  scare: 5.5,
  edge: 20,
})
// Rest acts: the chance of a peck (else a walk, else standing a little), and how long each lasts.
const ACTS = Object.freeze({
  peck: 0.34,
  walk: 0.94,
  turn: 0.3,
  peckMs: { min: 700, span: 900 },
  standMs: { min: 400, span: 600 },
  arriveMs: { min: 200, span: 500 },
  hopRestMs: { min: 120, span: 260 },
  sparrowPeckMs: { min: 400, span: 500 },
})
const FLAP = Object.freeze({ frameMs: 90, frames: WALK_FRAMES })
const PECK = Object.freeze({ frameMs: 200, frames: 2 })
// A walker's y counts this much more than x when judging how close they came.
const NEAR_Y_WEIGHT = 1.4

/** The far trees outside the shop row that sparrows perch in: the first, middle and last. */
export function perchesOf(pack: RegionPack): number[] {
  const row = shopRowSpanOf(pack.shops)
  const trees = FAR_TREES.filter(
    (tree) =>
      tree.x > SPARROW.edge &&
      tree.x < WORLD.w - SPARROW.edge &&
      (row === undefined || tree.x < row[0] || tree.x > row[1])
  )
  const last = trees.length - 1

  return [trees[0], trees[Math.floor(last / 2)], trees[last]].map((tree) => tree?.x ?? 0)
}

/** At rest on the kerb at home, or (by day) any place a flight left it. */
export function stepPigeon(critters: Critters, critter: Critter, step: CritterStep): void {
  if (critter.state === 'rest' || critter.state === 'walk') {
    if (isScared(critters, { critter, step, reach: PIGEON.scare })) {
      flush(critters, { critter, nowMs: step.nowMs })
      return
    }

    stepGround(critters, critter, step)
    return
  }

  stepFlight(critters, critter, step)
  critter.isShown = critter.state !== 'away'
}

// A walk to its target with a head bob, else the next act once this one is over.
function stepGround(critters: Critters, critter: Critter, step: CritterStep): void {
  const { rng } = critters
  const { nowMs } = step

  if (critter.state === 'walk') {
    walkTo(critter, { pxPerS: PIGEON.pxPerS, dt: step.dt, pxPerFrame: PIGEON.bobPx })

    if (critter.at.x === critter.tx) {
      rest(critter, { pose: 'stand', nowMs, rng, ms: ACTS.arriveMs })
    }

    return
  }

  critter.frame = critter.pose === 'peck' ? beatOf(nowMs, PECK) : 0

  if (nowMs < critter.nextAt) {
    return
  }

  const roll = rng.next()

  if (roll < ACTS.peck) {
    rest(critter, { pose: 'peck', nowMs, rng, ms: ACTS.peckMs })
  } else if (roll < ACTS.walk) {
    critter.state = 'walk'
    critter.pose = 'walk'
    critter.tx = critter.home.x + (rng.next() - 0.5) * PIGEON.wander
  } else {
    rest(critter, { pose: 'stand', nowMs, rng, ms: ACTS.standMs })
    critter.facing = rng.next() < ACTS.turn ? flip(critter.facing) : critter.facing
  }
}

// Up and away for a while, out of sight, then gliding back in to land near home.
function stepFlight(critters: Critters, critter: Critter, step: CritterStep): void {
  const { nowMs } = step

  if (critter.state === 'fly' && nowMs >= critter.t0) {
    critter.pose = 'fly'
    critter.at.x += critter.facing * PIGEON.flyPxPerS * step.dt
    critter.lift += PIGEON.risePxPerS * step.dt
    critter.frame = beatOf(nowMs, FLAP)
    critter.state = nowMs - critter.t0 > PIGEON.flyMs ? 'away' : 'fly'
  } else if (critter.state === 'away' && nowMs >= critter.nextAt) {
    critter.state = 'land'
    critter.t0 = nowMs
    critter.facing = critters.rng.next() < 0.5 ? 1 : -1
    critter.from = critter.home.x + (critters.rng.next() - 0.5) * PIGEON.wander
  } else if (critter.state === 'land') {
    const share = Math.min(1, (nowMs - critter.t0) / PIGEON.landMs)

    critter.at.x = critter.from - critter.facing * PIGEON.landFrom * (1 - share)
    critter.at.y = critter.home.y
    critter.lift = PIGEON.landLift * (1 - share)
    critter.frame = beatOf(nowMs, FLAP)

    if (share >= 1) {
      critter.tx = critter.at.x
      rest(critter, { pose: 'stand', nowMs, rng: critters.rng, ms: ACTS.standMs })
    }
  }
}

// The whole flock goes up a moment apart, all one way.
function flush(
  critters: Critters,
  at: { readonly critter: Critter; readonly nowMs: number }
): void {
  const { rng } = critters
  const facing: -1 | 1 = rng.next() < 0.5 ? -1 : 1
  let order = 0

  for (const other of critters.all) {
    const isFlock = other.kind === 'pigeon' && other.flock === at.critter.flock

    if (isFlock && (other.state === 'rest' || other.state === 'walk')) {
      other.state = 'fly'
      other.facing = facing
      other.t0 = at.nowMs + order * PIGEON.staggerMs
      other.nextAt = other.t0 + PIGEON.awayMs.min + rng.next() * PIGEON.awayMs.span
      order++
    }
  }
}

/** In its tree, fluttering down or up, or hopping and pecking on the pavement under it. */
export function stepSparrow(critters: Critters, critter: Critter, step: CritterStep): void {
  const { nowMs } = step
  const isLow = critter.state === 'rest' || critter.state === 'hop'

  if (isLow && isScared(critters, { critter, step, reach: SPARROW.scare })) {
    takeOff(critter, { nowMs, to: critter.home.x, state: 'rise' })
  } else if (critter.state === 'perch' && nowMs >= critter.nextAt) {
    takeOff(critter, { nowMs, to: critter.home.x, state: 'drop' })
  } else if (critter.state === 'drop' || critter.state === 'rise') {
    flutter(critters, critter, nowMs)
  } else if (critter.state === 'hop') {
    hop(critters, critter, nowMs)
  } else if (critter.state === 'rest') {
    stepPavement(critters, critter, nowMs)
  }
}

function takeOff(
  critter: Critter,
  at: { readonly nowMs: number; readonly to: number; readonly state: 'drop' | 'rise' }
): void {
  critter.state = at.state
  critter.pose = 'fly'
  critter.t0 = at.nowMs
  critter.from = critter.at.x
  critter.tx = at.to
  critter.facing = at.to >= critter.at.x ? 1 : -1
}

// Down from the perch to the pavement, or back up, with a little lift on the way.
function flutter(critters: Critters, critter: Critter, nowMs: number): void {
  const share = Math.min(1, (nowMs - critter.t0) / SPARROW.dropMs)
  const height = critter.state === 'drop' ? 1 - share : share

  critter.at.x = critter.from + (critter.tx - critter.from) * share
  critter.lift = SPARROWS.perchLift * height + SPARROW.flutterLift * Math.sin(Math.PI * share)
  critter.frame = beatOf(nowMs, FLAP)

  if (share < 1) {
    return
  }

  if (critter.state === 'drop') {
    rest(critter, { pose: 'stand', nowMs, rng: critters.rng, ms: ACTS.hopRestMs })
    critter.until = nowMs + span(critters, SPARROW.groundMs)
  } else {
    critter.state = 'perch'
    critter.pose = 'stand'
    critter.frame = 0
    critter.lift = SPARROWS.perchLift
    critter.nextAt = nowMs + span(critters, SPARROW.perchMs)
  }
}

// On the pavement: a hop, a peck, or back up to the tree once its time there is up.
function stepPavement(critters: Critters, critter: Critter, nowMs: number): void {
  const { rng } = critters

  critter.frame = critter.pose === 'peck' ? beatOf(nowMs, PECK) : 0

  if (nowMs < critter.nextAt) {
    return
  }

  if (nowMs >= critter.until) {
    takeOff(critter, { nowMs, to: critter.home.x, state: 'rise' })
  } else if (rng.next() < SPARROW.hopShare) {
    const reach = (rng.next() < 0.5 ? -1 : 1) * span(critters, SPARROW.hopPx)
    const home = critter.home.x

    critter.state = 'hop'
    critter.pose = 'walk'
    critter.t0 = nowMs
    critter.from = critter.at.x
    critter.tx = Math.max(
      home - SPARROW.reach,
      Math.min(home + SPARROW.reach, critter.at.x + reach)
    )
    critter.facing = critter.tx >= critter.from ? 1 : -1
  } else {
    rest(critter, { pose: 'peck', nowMs, rng, ms: ACTS.sparrowPeckMs })
  }
}

function hop(critters: Critters, critter: Critter, nowMs: number): void {
  const share = Math.min(1, (nowMs - critter.t0) / SPARROW.hopMs)

  critter.at.x = critter.from + (critter.tx - critter.from) * share
  critter.lift = SPARROW.hopLift * Math.sin(Math.PI * share)
  critter.frame = 1

  if (share >= 1) {
    rest(critter, { pose: 'stand', nowMs, rng: critters.rng, ms: ACTS.hopRestMs })
  }
}

// Someone, the dog or (for a pigeon) a vehicle on the kerb lane came within `reach`.
function isScared(
  critters: Critters,
  at: { readonly critter: Critter; readonly step: CritterStep; readonly reach: number }
): boolean {
  const { critter, step } = at

  for (const person of step.people) {
    const dy = (person.at.y - critter.at.y) * NEAR_Y_WEIGHT

    if (Math.hypot(person.at.x - critter.at.x, dy) < at.reach) {
      return true
    }
  }

  const { dog } = critters

  if (dog.isShown && Math.hypot(dog.at.x - critter.at.x, dog.at.y - critter.at.y) < at.reach) {
    return true
  }

  return critter.kind === 'pigeon' && isVehicleClose(critter, step.vehicles)
}

function isVehicleClose(critter: Critter, vehicles: readonly VehicleView[]): boolean {
  for (const vehicle of vehicles) {
    const isClose =
      Math.abs(vehicle.at.x - critter.at.x) < PIGEON.vehicle.dx &&
      Math.abs(vehicle.at.y - critter.at.y) < PIGEON.vehicle.dy

    if (isClose) {
      return true
    }
  }

  return false
}

function span(critters: Critters, range: Span): number {
  return range.min + critters.rng.next() * range.span
}
