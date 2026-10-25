import type { Point } from '@/web/scene/types'
import { aStar, isBlockedCell } from '@/web/scene/sim/actors/a-star'
import { NAV_CELL_PX, type NavGrid } from '@/web/scene/world/nav-grid'
import { MS_PER_SECOND } from '@/web/text/time'

/** A person on the floor as the navigation moves them: `route[leg]` is the waypoint walked to,
 *  `goal` the end of the walk, `heldMs` how long others have held them up. */
export interface Mover {
  pos: Point
  route: readonly Point[]
  leg: number
  speed: number
  heldMs: number
  isReplanned: boolean
  readonly seed: number
  grid: NavGrid | undefined
  goal: Point | undefined
}

const PERSON_MIN_GAP_PX = 7.3
// Someone this close to the line walked is in the way: passed on the walker's own right.
const IN_THE_WAY_PX = PERSON_MIN_GAP_PX / 2
const YIELD_AFTER_MS = 400
const REPLAN_AFTER_MS = 1_200
const FORCE_PASS_AFTER_MS = 9_000
// How far ahead a walker looks for people, and the turn it gives someone ahead (radians).
const LOOK_AHEAD_PX = 22
const SOFT_TURN_RAD = 0.6
const AHEAD_COS = 0.4
// Turns tried in order when the way ahead is taken; the widest only once held up.
const TURN_STEPS_RAD = [0.5, 1.1, Math.PI / 2] as const
const SIDESTEP_MIN_RAD = 1.2
// Within this of a blocked route end (a seat), line-of-sight samples are not checked.
const SEAT_END_PX = 9
const SNAP_MAX_CELLS = 16
const SNAP_NORTH_COST_PX = 8
const SNAP_SIDE_COST_PX = 3
// Replanning around people: each person blocks this radius, unless standing at the goal.
const PERSON_BLOCK_PX = 9
const PERSON_NEAR_GOAL_PX = 10
// The last leg into a blocked goal (a chair) may cross blocked cells this close to it.
const GOAL_SLACK_PX = 16
const YIELD_MARGIN_PX = 4
const HELD_DECAY = 2
const EPSILON = 0.01

interface Search {
  readonly grid: NavGrid
  readonly from: Point
  readonly to: Point
  readonly extra?: Uint8Array
}

/** The waypoints from `from` to `to`, `to` last: A* over 8 neighbours with no corner cutting,
 *  pulled straight wherever the floor is in sight. A start or goal inside a chair snaps to the
 *  nearest free cell, south first; `undefined` when nobody can get there in `NAV_MAX_NODES`. */
export function findRoute(grid: NavGrid, from: Point, to: Point): readonly Point[] | undefined {
  return searchRoute({ grid, from, to })
}

/** One step of `mover` toward its waypoint, around the people in `others`: a soft turn to its own
 *  right for someone ahead, a sidestep when held up, the lower seed steps back after
 *  `YIELD_AFTER_MS`, a replan around people after `REPLAN_AFTER_MS`, a forced pass after
 *  `FORCE_PASS_AFTER_MS`. Lands exactly on the waypoint when it reaches it. */
export function avoidPeople(mover: Mover, others: readonly Mover[], dtMs: number): void {
  const target = mover.route[mover.leg]

  if (target === undefined) {
    return
  }

  const d = distance(mover.pos, target)
  const len = Math.min((mover.speed * dtMs) / MS_PER_SECOND, d)
  const near = others.filter((o) => distance(o.pos, mover.pos) < LOOK_AHEAD_PX + len)

  // A sidestep beside someone that gets no closer still counts as held up, or two walkers trading
  // sidesteps in a doorway would never reach the step-back or the replan.
  const isBeside = near.some(
    (o) => distance(o.pos, mover.pos) < PERSON_MIN_GAP_PX + YIELD_MARGIN_PX
  )
  const isMoved = tryStep({ mover, target, len, near })

  if (isMoved && (!isBeside || distance(mover.pos, target) < d - len / 2)) {
    mover.heldMs = Math.max(0, mover.heldMs - dtMs * HELD_DECAY)
    mover.isReplanned = mover.heldMs > 0 && mover.isReplanned
    return
  }

  mover.heldMs += dtMs
  resolveHold({ mover, target, len, near })
}

/** Plans the way to `mover.goal` again with the people in `others` as blocked cells. */
export function replanAroundPeople(
  mover: Mover,
  others: readonly Mover[]
): readonly Point[] | undefined {
  const { grid, goal } = mover

  if (grid === undefined || goal === undefined) {
    return undefined
  }

  return searchRoute({ grid, from: mover.pos, to: goal, extra: maskPeople(grid, mover, others) })
}

/** `p` when someone may stand there, else the nearest free spot (south first); `p` when none is
 *  near. */
export function toFreePoint(grid: NavGrid, p: Point): Point {
  const cell = snapCell(grid, p)

  return cell === undefined ? p : grid.pointOf(cell)
}

/** Nothing on the grid stands between `a` and `b`. */
export function isInSight(grid: NavGrid, a: Point, b: Point): boolean {
  return isClearLine({ grid, from: a, to: b })
}

function isBlockedAt(grid: NavGrid, p: Point, extra?: Uint8Array): boolean {
  const cell = grid.cellOf(p)

  return cell < 0 || grid.blocked[cell] === 1 || extra?.[cell] === 1
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

interface StepJob {
  readonly mover: Mover
  readonly target: Point
  readonly len: number
  readonly near: readonly Mover[]
}

function tryStep(job: StepJob): boolean {
  const { mover, target, len } = job
  const d = distance(mover.pos, target)

  if (d < EPSILON) {
    mover.pos = target
    return true
  }

  const ux = (target.x - mover.pos.x) / d
  const uy = (target.y - mover.pos.y) / d
  const soft = softTurnOf(job, ux, uy)
  const side = soft < 0 ? -1 : 1
  const base = Math.atan2(uy, ux)

  for (const turn of [soft, ...TURN_STEPS_RAD.flatMap((t) => [soft + side * t, soft - side * t])]) {
    if (turn !== soft && Math.abs(turn) > SIDESTEP_MIN_RAD && job.mover.heldMs === 0) {
      continue
    }

    const isExact = soft === 0 && turn === 0 && len >= d
    const next = isExact
      ? target
      : {
          x: mover.pos.x + Math.cos(base + turn) * len,
          y: mover.pos.y + Math.sin(base + turn) * len,
        }

    if (isStaticOk(mover, next) && isPeopleOk(job, next)) {
      mover.pos = next
      return true
    }
  }

  return false
}

// Someone ahead: a person in the way (closer to the line than the gap) is passed on the walker's
// own right, so two walkers meeting round a third take opposite sides; one off the line is passed
// on the side away from them. Either way, the other side when that one has no room.
function softTurnOf(job: StepJob, ux: number, uy: number): number {
  let soft = 0

  for (const other of job.near) {
    const rx = other.pos.x - job.mover.pos.x
    const ry = other.pos.y - job.mover.pos.y
    const rd = Math.hypot(rx, ry) || 1

    if ((rx * ux + ry * uy) / rd < AHEAD_COS || rd > LOOK_AHEAD_PX) {
      continue
    }

    const cross = ux * ry - uy * rx
    const weight = Math.min(1, (LOOK_AHEAD_PX - rd) / (LOOK_AHEAD_PX - PERSON_MIN_GAP_PX))
    const preferred = Math.abs(cross) < IN_THE_WAY_PX || cross <= 0 ? 1 : -1
    const away = hasRoomBeside(job, other, { ux, uy, side: preferred }) ? preferred : -preferred
    const turn = away * SOFT_TURN_RAD * weight

    soft = Math.abs(turn) > Math.abs(soft) ? turn : soft
  }

  return soft
}

// The place the walker passes `other` on that side (its right for side 1) is off furniture and
// clear of everyone else.
function hasRoomBeside(
  job: StepJob,
  other: Mover,
  heading: { readonly ux: number; readonly uy: number; readonly side: number }
): boolean {
  const grid = job.mover.grid
  const aside = {
    x: other.pos.x - heading.uy * heading.side * PERSON_MIN_GAP_PX,
    y: other.pos.y + heading.ux * heading.side * PERSON_MIN_GAP_PX,
  }
  const isFree = grid === undefined || !isBlockedAt(grid, aside)

  return isFree && job.near.every((o) => o === other || distance(o.pos, aside) >= PERSON_MIN_GAP_PX)
}

function resolveHold(job: StepJob): void {
  const { mover, target, len } = job

  if (mover.heldMs > YIELD_AFTER_MS && stepBack(job)) {
    return
  }

  if (mover.heldMs > FORCE_PASS_AFTER_MS) {
    const d = distance(mover.pos, target) || 1

    mover.pos = {
      x: mover.pos.x + ((target.x - mover.pos.x) / d) * len,
      y: mover.pos.y + ((target.y - mover.pos.y) / d) * len,
    }
    mover.heldMs = 0
    return
  }

  if (mover.heldMs > REPLAN_AFTER_MS && !mover.isReplanned) {
    mover.isReplanned = true

    const route = replanAroundPeople(mover, job.near)

    if (route !== undefined) {
      mover.route = route
      mover.leg = 0
    }
  }
}

// Held up by a walker with the right of way (the higher seed): step away from it, never toward
// anyone.
function stepBack(job: StepJob): boolean {
  const { mover, len } = job
  const winners = job.near.filter(
    (o) =>
      o.leg < o.route.length &&
      o.seed > mover.seed &&
      distance(o.pos, mover.pos) < PERSON_MIN_GAP_PX + YIELD_MARGIN_PX
  )

  if (winners.length === 0) {
    return false
  }

  const bx = winners.reduce((sum, o) => sum + mover.pos.x - o.pos.x, 0)
  const by = winners.reduce((sum, o) => sum + mover.pos.y - o.pos.y, 0)
  const bd = Math.hypot(bx, by) || 1
  const next = { x: mover.pos.x + (bx / bd) * len, y: mover.pos.y + (by / bd) * len }

  if (!(isStaticOk(mover, next) && isPeopleOk(job, next))) {
    return false
  }

  mover.pos = next

  return true
}

// Off a blocked cell, unless the walker stands on one already (rising from a chair) or is on the
// last leg into a blocked goal.
function isStaticOk(mover: Mover, p: Point): boolean {
  const grid = mover.grid

  if (grid === undefined || !isBlockedAt(grid, p) || isBlockedAt(grid, mover.pos)) {
    return true
  }

  const goal = mover.goal
  const isLastLeg = mover.leg === mover.route.length - 1

  return (
    isLastLeg && goal !== undefined && isBlockedAt(grid, goal) && distance(p, goal) <= GOAL_SLACK_PX
  )
}

function isPeopleOk(job: StepJob, p: Point): boolean {
  return isClearOfPeople(job.mover, job.near, p)
}

/** A step to `p` keeps `PERSON_MIN_GAP_PX` from everyone, or moves away from whoever it is
 *  closer to. */
export function isClearOfPeople(mover: Mover, others: readonly Mover[], p: Point): boolean {
  return others.every((o) => {
    const dn = distance(p, o.pos)

    return dn >= PERSON_MIN_GAP_PX || dn >= distance(mover.pos, o.pos) - EPSILON
  })
}

function maskPeople(grid: NavGrid, mover: Mover, others: readonly Mover[]): Uint8Array {
  const mask = new Uint8Array(grid.blocked.length)
  const goal = mover.goal ?? mover.pos
  const reach = Math.ceil(PERSON_BLOCK_PX / NAV_CELL_PX)

  // Everyone counts, the person holding the walker up included; only someone at the goal does not.
  for (const other of others) {
    if (distance(other.pos, goal) < PERSON_NEAR_GOAL_PX) {
      continue
    }

    const center = grid.cellOf(other.pos)

    for (let dj = -reach; dj <= reach && center >= 0; dj++) {
      for (let di = -reach; di <= reach; di++) {
        markNear({ grid, mask, center, other: other.pos }, di, dj)
      }
    }
  }

  return mask
}

function markNear(
  job: { grid: NavGrid; mask: Uint8Array; center: number; other: Point },
  di: number,
  dj: number
): void {
  const { grid } = job
  const i = (job.center % grid.cols) + di
  const j = Math.floor(job.center / grid.cols) + dj

  if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) {
    return
  }

  const cell = j * grid.cols + i

  if (distance(grid.pointOf(cell), job.other) <= PERSON_BLOCK_PX) {
    job.mask[cell] = 1
  }
}

function searchRoute(search: Search): readonly Point[] | undefined {
  const { grid, from, to, extra } = search

  if (extra === undefined && isClearLine(search)) {
    return [to]
  }

  const start = snapCell(grid, from, extra) ?? grid.cellOf(from)
  const goal = snapCell(grid, to, extra) ?? grid.cellOf(to)

  if (start < 0 || goal < 0) {
    return undefined
  }

  const cells = aStar({ grid, start, goal, ...(extra === undefined ? {} : { extra }) })

  return cells === undefined
    ? undefined
    : pullString(search, [from, ...cells.map((cell) => grid.pointOf(cell)), to])
}

// Keeps a point only where the one before it cannot see further ahead.
function pullString(search: Search, points: readonly Point[]): readonly Point[] {
  const out: Point[] = []
  let i = 0

  while (i < points.length - 1) {
    let j = i + 1

    for (let k = i + 2; k < points.length; k++) {
      const from = points[i]
      const to = points[k]

      if (from === undefined || to === undefined || !isClearLine({ ...search, from, to })) {
        break
      }

      j = k
    }

    const kept = points[j]

    if (kept !== undefined) {
      out.push(kept)
    }

    i = j
  }

  return out
}

// Samples every half cell; samples within `SEAT_END_PX` of a blocked end are not checked.
function isClearLine(search: Search): boolean {
  const { grid, from, to, extra } = search
  const d = distance(from, to)
  const n = Math.max(1, Math.ceil(d / (NAV_CELL_PX / 2)))
  const isFromBlocked = isBlockedAt(grid, from, extra)
  const isToBlocked = isBlockedAt(grid, to)

  for (let k = 0; k <= n; k++) {
    const p = { x: from.x + ((to.x - from.x) * k) / n, y: from.y + ((to.y - from.y) * k) / n }

    if (!isBlockedAt(grid, p, extra)) {
      continue
    }

    const isNearFrom = isFromBlocked && (k * d) / n <= SEAT_END_PX
    const isNearTo = isToBlocked && ((n - k) * d) / n <= SEAT_END_PX

    if (!(isNearFrom || isNearTo)) {
      return false
    }
  }

  return true
}

// The point's own cell when free, else the nearest free one, south of it first (where a chair is
// entered from).
function snapCell(grid: NavGrid, p: Point, extra?: Uint8Array): number | undefined {
  const origin = grid.cellOf(p)

  if (origin < 0 || !isBlockedCell(grid, origin, extra)) {
    return undefined
  }

  const i0 = origin % grid.cols
  const j0 = Math.floor(origin / grid.cols)
  let best: number | undefined
  let bestCost = Number.POSITIVE_INFINITY

  for (let r = 1; r <= SNAP_MAX_CELLS && !(best !== undefined && r * NAV_CELL_PX > bestCost); r++) {
    for (const [di, dj] of ringOf(r)) {
      const cell = freeCellAt(grid, { i: i0 + di, j: j0 + dj }, extra)
      const cost = snapCostOf(di, dj)

      if (cell !== undefined && cost < bestCost) {
        best = cell
        bestCost = cost
      }
    }
  }

  return best
}

// Distance, plus a toll for the north side and for the sides: a chair is entered from the south.
function snapCostOf(di: number, dj: number): number {
  const north = dj < 0 ? SNAP_NORTH_COST_PX : 0
  const side = Math.abs(di) > Math.abs(dj) ? SNAP_SIDE_COST_PX : 0

  return Math.hypot(di, dj) * NAV_CELL_PX + north + side
}

function freeCellAt(
  grid: NavGrid,
  at: { readonly i: number; readonly j: number },
  extra: Uint8Array | undefined
): number | undefined {
  const isInGrid = at.i >= 0 && at.j >= 0 && at.i < grid.cols && at.j < grid.rows
  const cell = at.j * grid.cols + at.i

  return isInGrid && !isBlockedCell(grid, cell, extra) ? cell : undefined
}

function ringOf(r: number): (readonly [number, number])[] {
  const ring: (readonly [number, number])[] = []

  for (let dj = -r; dj <= r; dj++) {
    for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) === r) {
        ring.push([di, dj])
      }
    }
  }

  return ring
}
