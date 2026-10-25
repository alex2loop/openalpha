import type { Point } from '@/web/scene/types'
import type { NavGrid } from '@/web/scene/world/nav-grid'
import {
  avoidPeople,
  distance,
  findRoute,
  isInSight,
  type Mover,
  replanAroundPeople,
} from '@/web/scene/sim/actors/nav'
import { MS_PER_SECOND } from '@/web/text/time'

/** One person's walk: where they stand now and one sim step ago, the route and its leg, and the
 *  net-movement watch that replans a walker stepping in place. */
export interface WalkerState extends Mover {
  prev: Point
  stuck: { from: Point; sinceMs: number; tries: number }
}

type WalkStep = 'walking' | 'arrived' | 'blocked'

const WALK_PX_PER_S = 22
// Each person walks between these shares of the pace, from their seed.
const PACE_MIN = 0.9
const PACE_SPREAD = 0.2
const SEED_RANGE = 4_294_967_296
// A waypoint passed this close counts only when the next one is in sight.
const WAYPOINT_EARLY_PX = 2.5
const REPLAN_MS = 1_200
const STUCK_PX = 3
const STUCK_MAX_TRIES = 3
const ARRIVED_PX = 0.01

/** A person standing at `at`, not walking; `seed` (from the actor id) sets their pace and who
 *  gives way. */
export function createWalker(at: Point, seed: number): WalkerState {
  return {
    pos: at,
    prev: at,
    route: [],
    leg: 0,
    speed: WALK_PX_PER_S * (PACE_MIN + (PACE_SPREAD * seed) / SEED_RANGE),
    heldMs: 0,
    isReplanned: false,
    seed,
    grid: undefined,
    goal: undefined,
    stuck: { from: at, sinceMs: 0, tries: 0 },
  }
}

/** Starts a walk to `goal` over `grid`, turning back from any walk in progress. False when no
 *  route exists: the walker stays put, it never jumps. */
export function startWalk(walker: WalkerState, grid: NavGrid, goal: Point): boolean {
  const route = findRoute(grid, walker.pos, goal)

  if (route === undefined) {
    return false
  }

  walker.grid = grid
  walker.goal = goal
  walker.route = route
  walker.leg = 0
  walker.heldMs = 0
  walker.isReplanned = false
  walker.stuck = { from: walker.pos, sinceMs: 0, tries: 0 }

  return true
}

/** Puts the walker at `at` at once, ending any walk: a resume, or reduced motion. */
export function placeWalker(walker: WalkerState, at: Point): void {
  walker.pos = at
  walker.prev = at
  walker.route = []
  walker.leg = 0
  walker.goal = undefined
  walker.heldMs = 0
}

export function isWalking(walker: WalkerState): boolean {
  return walker.leg < walker.route.length
}

/** One sim step of the walk, around `others` on the same floor. */
export function stepWalk(walker: WalkerState, others: readonly Mover[], dtMs: number): WalkStep {
  walker.prev = walker.pos

  if (!isWalking(walker)) {
    return 'arrived'
  }

  passEarlyWaypoint(walker)
  watchStuck(walker, others, dtMs)

  const target = walker.route[walker.leg]

  if (target === undefined) {
    return finishWalk(walker)
  }

  if (walker.stuck.tries > STUCK_MAX_TRIES) {
    walkStraight(walker, target, dtMs)
  } else {
    avoidPeople(walker, others, dtMs)
  }

  if (distance(walker.pos, target) < ARRIVED_PX) {
    walker.leg++

    if (!isWalking(walker)) {
      return finishWalk(walker)
    }
  }

  return walker.heldMs > 0 ? 'blocked' : 'walking'
}

function finishWalk(walker: WalkerState): WalkStep {
  walker.route = []
  walker.leg = 0
  walker.goal = undefined

  return 'arrived'
}

// Beside a waypoint with the next one in sight: it counts as passed. Without sight it does not,
// or a walker would cut a corner into furniture.
function passEarlyWaypoint(walker: WalkerState): void {
  const target = walker.route[walker.leg]
  const next = walker.route[walker.leg + 1]

  if (
    target !== undefined &&
    next !== undefined &&
    walker.grid !== undefined &&
    distance(walker.pos, target) <= WAYPOINT_EARLY_PX &&
    isInSight(walker.grid, walker.pos, next)
  ) {
    walker.leg++
  }
}

// Under `STUCK_PX` of net movement over `REPLAN_MS` (a stale leg, or sidesteps that cancel out):
// plan again around people, then on the grid alone, then straight to the waypoint; after
// `STUCK_MAX_TRIES` the walker walks straight on.
function watchStuck(walker: WalkerState, others: readonly Mover[], dtMs: number): void {
  const stuck = walker.stuck

  stuck.sinceMs += dtMs

  if (stuck.sinceMs < REPLAN_MS) {
    return
  }

  const net = distance(walker.pos, stuck.from)

  walker.stuck = { from: walker.pos, sinceMs: 0, tries: net >= STUCK_PX ? 0 : stuck.tries + 1 }

  if (net >= STUCK_PX || walker.stuck.tries > STUCK_MAX_TRIES) {
    return
  }

  const grid = walker.grid
  const goal = walker.goal
  const target = walker.route[walker.leg]
  const route =
    replanAroundPeople(walker, others) ??
    (grid === undefined || goal === undefined ? undefined : findRoute(grid, walker.pos, goal)) ??
    (target === undefined ? undefined : [target, ...walker.route.slice(walker.leg + 1)])

  if (route !== undefined) {
    walker.route = route
    walker.leg = 0
  }
}

function walkStraight(walker: WalkerState, target: Point, dtMs: number): void {
  const d = distance(walker.pos, target)
  const len = (walker.speed * dtMs) / MS_PER_SECOND

  walker.pos =
    d <= len
      ? target
      : {
          x: walker.pos.x + ((target.x - walker.pos.x) / d) * len,
          y: walker.pos.y + ((target.y - walker.pos.y) / d) * len,
        }
}
