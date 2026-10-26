import type { Vehicle } from '@/web/scene/sim/street/flows'
import type { Traffic } from '@/web/scene/sim/street/traffic'
import type {
  ErrandItem,
  Heading,
  PersonKind,
  PersonView,
  StaffLook,
} from '@/web/scene/street-types'
import type { createRng } from '@/web/scene/world/rng'
import { signalOf } from '@/web/scene/sim/street/signals'
import { WAVE_FRAME } from '@/web/scene/street-types'
import { WORLD } from '@/web/scene/types'
import { CROSSING, NORTH, SIDE_ROAD } from '@/web/scene/world/street-layout'
import { MS_PER_SECOND } from '@/web/text/time-units'

// One gait cycle per this many px walked, a jogger's longer; standing again this long after the
// last step; a wave swings its arm this often.
const WALK_PX_PER_FRAME = 0.97
const JOG_PX_PER_FRAME = 1.4
const STAND_AFTER_MS = 280
const WAVE_FRAME_MS = 260
const WALK_FRAMES = 4
const ROUTE_MAX = 7
// A car this close to the zebra keeps walkers on the kerb.
const ZEBRA_CLEAR_PX = 6
/** Walkers come in and go this far past each side wall along the far pavement. */
export const WALK_REACH_PX = 240
/** A walker's pace, from this share of the walking speed over a spread. */
export const WALK_PACE = Object.freeze({ from: 0.9, span: 0.25 })
const WALK_PX_PER_S = 3.5
const LOOK_SEEDS = 0x1_00_00
// A walker placed by the clock stands somewhere along its first leg, short of its end; a new one
// starts its gait at some point of a stride.
const PLACED_SHARE = 0.9
const STRIDE_SEED_PX = 3

/** Where people walk: the far pavement's line, the doors at its back edge, either kerb at the
 *  crossing, the top of the side pavements and the far edge of the plaza south of the building. */
export const PAVEMENT = Object.freeze({
  far: NORTH.roadTop - 3.5,
  door: NORTH.farTop - 1.2,
  farKerb: NORTH.roadTop - 1.4,
  nearKerb: NORTH.roadBottom + 1.4,
  sideTop: NORTH.roadBottom + 3,
  south: WORLD.h + 10,
})
/** The side pavements, as distances out from the building's side walls: the near one beside the
 *  building (the crossing's line) and the one past the side street. */
export const SIDE_WALKS = Object.freeze({ near: -CROSSING.x, far: SIDE_ROAD.to + 3 })

type PedTask = 'walk' | 'wait' | 'sit' | 'pickup' | 'receive' | 'shelter'

type Rng = ReturnType<typeof createRng>

interface MutablePoint {
  x: number
  y: number
}

/** One person of a street pool, written only by the street sim. `route` holds `routeLength`
 *  points walked in turn; the leg toward `route[crossLeg]` waits for the walk signal. */
export interface Ped extends PersonView {
  on: boolean
  prev: MutablePoint
  at: MutablePoint
  kind: PersonKind
  facing: Heading
  frame: number
  /** The frame shown before this step's, so a person who only stopped still repaints once. */
  lastFrame: number
  look: number
  item: ErrandItem | undefined
  staff: StaffLook | undefined
  readonly route: MutablePoint[]
  routeLength: number
  leg: number
  crossLeg: number
  isAtKerb: boolean
  speed: number
  dist: number
  movedAt: number
  holdUntil: number
  waveUntil: number
  task: PedTask
  spot: number
  vehicle: Vehicle | undefined
  umbrella: number
  hat: number
  /** The weather epoch this person was last dressed for. */
  dressed: number
  isHurried: boolean
}

/** The street's walkers: the pool, the stream of chance they draw on, and the greeting clock. */
export interface Peds {
  readonly pool: Ped[]
  readonly tick: WalkTick
  rng: Rng
  greetCheckAt: number
  greetReadyAt: number
  /** The weather the walkers keep to, set by the street's weather. */
  readonly weather: { isRaining: boolean; isHeat: boolean }
}

/** A walk step's clock and whether the zebra may be started now; one per group of walkers, moved
 *  on each step. */
export interface WalkTick {
  dt: number
  nowMs: number
  canCross: boolean
}

/** What a people step reads: the traffic it shares the street with, the page minute, sim time and
 *  the seconds stepped. */
export interface PedStep {
  readonly traffic: Traffic
  readonly minute: number
  readonly nowMs: number
  readonly dt: number
}

export function createPed(): Ped {
  return {
    on: false,
    prev: { x: 0, y: 0 },
    at: { x: 0, y: 0 },
    kind: 'walker',
    facing: 'east',
    frame: 0,
    lastFrame: 0,
    look: 0,
    item: undefined,
    staff: undefined,
    route: Array.from({ length: ROUTE_MAX }, () => ({ x: 0, y: 0 })),
    routeLength: 0,
    leg: 0,
    crossLeg: -1,
    isAtKerb: false,
    speed: 0,
    dist: 0,
    movedAt: 0,
    holdUntil: 0,
    waveUntil: 0,
    task: 'walk',
    spot: -1,
    vehicle: undefined,
    umbrella: 0,
    hat: 0,
    dressed: -1,
    isHurried: false,
  }
}

/** Puts the person at `at` with an empty route and nothing in hand. */
export function placePed(ped: Ped, at: { readonly x: number; readonly y: number }): void {
  ped.on = true
  ped.at.x = at.x
  ped.at.y = at.y
  ped.prev.x = at.x
  ped.prev.y = at.y
  ped.routeLength = 0
  ped.leg = 0
  ped.crossLeg = -1
  ped.isAtKerb = false
  ped.holdUntil = 0
  ped.waveUntil = 0
  ped.item = undefined
  ped.staff = undefined
  ped.vehicle = undefined
  ped.spot = -1
  ped.task = 'walk'
  ped.umbrella = 0
  ped.hat = 0
  ped.dressed = -1
  ped.isHurried = false
}

// A free slot of a pool, dressed as a passer-by at `at`.
export function takePed<T extends Ped>(
  peds: { readonly pool: readonly T[]; readonly rng: Rng },
  at: { readonly x: number; readonly y: number }
): T | undefined {
  const ped = peds.pool.find((candidate) => !candidate.on)

  if (ped === undefined) {
    return undefined
  }

  placePed(ped, at)
  ped.kind = 'walker'
  ped.look = peds.rng.int(0, LOOK_SEEDS - 1)
  ped.speed = WALK_PX_PER_S * (WALK_PACE.from + peds.rng.next() * WALK_PACE.span)
  ped.dist = peds.rng.next() * STRIDE_SEED_PX

  return ped
}

// From the route's first point, or somewhere along its first leg when placed by the clock.
export function startOn(
  peds: { readonly rng: Rng },
  ped: Ped,
  at: { readonly nowMs: number; readonly isPlaced: boolean }
): void {
  const [first, second] = ped.route
  const share =
    at.isPlaced && ped.routeLength > 1 && ped.crossLeg !== 1 ? peds.rng.next() * PLACED_SHARE : 0

  if (first === undefined || second === undefined) {
    return
  }

  ped.at.x = first.x + (second.x - first.x) * share
  ped.at.y = first.y + (second.y - first.y) * share
  ped.prev.x = ped.at.x
  ped.prev.y = ped.at.y
  ped.leg = 1
  ped.movedAt = at.nowMs
}

/** Starts a new route from where the person stands. */
export function clearRoute(ped: Ped): void {
  ped.routeLength = 0
  ped.leg = 0
  ped.crossLeg = -1
  ped.isAtKerb = false
}

/** Adds a point to the route. */
export function addPoint(ped: Ped, x: number, y: number): void {
  const point = ped.route[ped.routeLength]

  if (point !== undefined) {
    point.x = x
    point.y = y
    ped.routeLength++
  }
}

/** Adds a point over the north street: the leg to it waits on the kerb for the walk signal. */
export function addCrossing(ped: Ped, x: number, y: number): void {
  ped.crossLeg = ped.routeLength
  addPoint(ped, x, y)
}

/** One step along the route at the person's speed; true once the last point is reached. The
 *  crossing leg starts only while `canCross`, and once started it is walked to the end. */
export function walkPed(ped: Ped, tick: WalkTick): boolean {
  ped.prev.x = ped.at.x
  ped.prev.y = ped.at.y

  let left = ped.speed * tick.dt

  while (ped.leg < ped.routeLength && left > 0) {
    if (ped.leg === ped.crossLeg && ped.isAtKerb && !tick.canCross) {
      return false
    }

    const point = ped.route[ped.leg] ?? ped.at
    const dx = point.x - ped.at.x
    const dy = point.y - ped.at.y
    const distance = Math.hypot(dx, dy)
    const reach = Math.min(distance, left)

    if (distance > 0) {
      ped.at.x += (dx / distance) * reach
      ped.at.y += (dy / distance) * reach
      ped.facing = headingOf(dx, dy)
      ped.dist += reach
      ped.movedAt = tick.nowMs
    }

    left -= reach
    ped.isAtKerb = false

    if (reach >= distance) {
      ped.leg++
      ped.isAtKerb = ped.leg === ped.crossLeg
    }
  }

  return ped.leg >= ped.routeLength
}

/** Moves the person's gait frame on to `nowMs`. */
export function syncGait(ped: Ped, nowMs: number): void {
  ped.lastFrame = ped.frame
  ped.frame = gaitOf(ped, nowMs)
}

/** The person moved or changed frame this step. */
export function hasPedChanged(ped: PersonView & { readonly lastFrame: number }): boolean {
  return ped.prev.x !== ped.at.x || ped.prev.y !== ped.at.y || ped.lastFrame !== ped.frame
}

/** The gait frame: a wave's two frames, standing once still, else the walk's four, one cycle per
 *  stretch walked. */
export function gaitOf(ped: Ped, nowMs: number): number {
  if (nowMs < ped.waveUntil) {
    return WAVE_FRAME + (Math.floor(nowMs / WAVE_FRAME_MS) % 2)
  }

  if (ped.kind === 'sitter' || nowMs - ped.movedAt > STAND_AFTER_MS) {
    return 0
  }

  const perFrame = ped.kind === 'jogger' ? JOG_PX_PER_FRAME : WALK_PX_PER_FRAME

  return 1 + (Math.floor(ped.dist / perFrame) % WALK_FRAMES)
}

/** Moves the tick on to this step; the zebra may be started until `leadMs` before the cars' green
 *  (never once the walk lamp flashes, for `Infinity`). */
export function syncWalkTick(tick: WalkTick, step: PedStep, leadMs: number): void {
  tick.dt = step.dt
  tick.nowMs = step.nowMs
  tick.canCross = canCrossAt(step.traffic.pool, step.nowMs, leadMs)
}

// The walk lamp is lit (or flashing with more than `leadMs` left) and no car stands on the zebra.
function canCrossAt(vehicles: readonly Vehicle[], nowMs: number, leadMs: number): boolean {
  const walk = signalOf('walk', nowMs)
  const isLit =
    walk.lamp === 'walk' || (walk.lamp === 'flash' && walk.seconds * MS_PER_SECOND > leadMs)

  if (!isLit) {
    return false
  }

  for (const vehicle of vehicles) {
    const isOnZebra =
      vehicle.on &&
      vehicle.flow.street === 'north' &&
      Math.abs(vehicle.pos - CROSSING.x) < vehicle.len / 2 + ZEBRA_CLEAR_PX

    if (isOnZebra) {
      return false
    }
  }

  return true
}

function headingOf(dx: number, dy: number): Heading {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'east' : 'west'
  }

  return dy >= 0 ? 'south' : 'north'
}

export function countOf(peds: Peds, kind: Ped['kind']): number {
  let count = 0

  for (const ped of peds.pool) {
    count += ped.on && ped.kind === kind ? 1 : 0
  }

  return count
}

export function countTask(peds: Peds, task: Ped['task']): number {
  let count = 0

  for (const ped of peds.pool) {
    count += ped.on && ped.task === task ? 1 : 0
  }

  return count
}
