import type { NavGrid } from '@/web/scene/world/nav-grid'

/** Cells from `start` to `goal`; `extra` marks more blocked cells (people). */
interface CellSearch {
  readonly grid: NavGrid
  readonly start: number
  readonly goal: number
  readonly extra?: Uint8Array
}

/** One grid's search buffers, reused by every search on it: a cell's score and parent count only
 *  when its stamp is the current search's. */
interface Scratch {
  readonly score: Float64Array
  readonly parent: Int32Array
  readonly seen: Uint32Array
  readonly closed: Uint32Array
  readonly walls: Uint8Array
  readonly heapCells: Int32Array
  readonly heapCosts: Float64Array
  heapSize: number
  stamp: number
}

const NAV_MAX_NODES = 30_000
const DIAGONAL = Math.SQRT2
const OCTILE = Math.SQRT2 - 1
const STEP_DI = [1, -1, 0, 0, 1, 1, -1, -1] as const
const STEP_DJ = [0, 0, 1, -1, 1, -1, 1, -1] as const
const STRAIGHT_STEPS = 4
// A weighted heuristic: the search floods far less of a room it cannot cross; a route may run a
// little longer than the shortest, and string pulling straightens it.
const HEURISTIC_WEIGHT = 1.5
// The stamp wraps long before a page could run this many searches; the buffers reset then.
const MAX_STAMP = 0xff_ff_ff_f0
// Every heap entry is one relaxed neighbour of an expanded cell, plus the start.
const HEAP_MAX = NAV_MAX_NODES * 8 + 1

const scratches = new WeakMap<NavGrid, Scratch>()

/** Weighted octile A* over 8 neighbours with no corner cutting: the cells from `start` to `goal`, or
 *  undefined when none is found within `NAV_MAX_NODES` expanded cells. */
export function aStar(search: CellSearch): number[] | undefined {
  const { grid, start, goal } = search
  const s = scratchOf(grid)
  const walls = wallsOf(s, search)
  const cols = grid.cols
  const goalI = goal % cols
  const goalJ = (goal - goalI) / cols
  const job: Expansion = { s, grid, walls, goalI, goalJ }
  let expanded = 0

  s.stamp++
  s.heapSize = 0
  s.seen[start] = s.stamp
  s.score[start] = 0
  s.parent[start] = -1
  pushHeap(s, start, octile(start % cols, Math.floor(start / cols), job))

  while (s.heapSize > 0) {
    const u = popHeap(s)

    if (s.closed[u] === s.stamp) {
      continue
    }

    s.closed[u] = s.stamp

    if (u === goal) {
      return toCells(s.parent, goal)
    }

    if (++expanded > NAV_MAX_NODES) {
      return undefined
    }

    expand(job, u)
  }

  return undefined
}

export function isBlockedCell(grid: NavGrid, cell: number, extra?: Uint8Array): boolean {
  return grid.blocked[cell] === 1 || extra?.[cell] === 1
}

function scratchOf(grid: NavGrid): Scratch {
  const held = scratches.get(grid)

  if (held !== undefined && held.stamp < MAX_STAMP) {
    return held
  }

  const size = grid.blocked.length
  const fresh: Scratch = {
    score: new Float64Array(size),
    parent: new Int32Array(size),
    seen: new Uint32Array(size),
    closed: new Uint32Array(size),
    walls: new Uint8Array(size),
    heapCells: new Int32Array(HEAP_MAX),
    heapCosts: new Float64Array(HEAP_MAX),
    heapSize: 0,
    stamp: 0,
  }

  scratches.set(grid, fresh)

  return fresh
}

// The grid itself, or the grid with the people's cells laid over it in the scratch buffer.
function wallsOf(s: Scratch, search: CellSearch): Uint8Array {
  const { blocked } = search.grid
  const extra = search.extra

  if (extra === undefined) {
    return blocked
  }

  for (let c = 0; c < blocked.length; c++) {
    s.walls[c] = (blocked[c] ?? 1) | (extra[c] ?? 0)
  }

  return s.walls
}

interface Expansion {
  readonly s: Scratch
  readonly grid: NavGrid
  readonly walls: Uint8Array
  readonly goalI: number
  readonly goalJ: number
}

// The eight neighbours of `u`, straight ones first. No bounds test: the grid's first and last rows
// and its last column are always blocked (outside the building), so a step from a free cell lands
// on the grid, and a step off the first column wraps onto that blocked last column.
function expand(job: Expansion, u: number): void {
  const { s, walls } = job
  const { seen, score: scores, parent, stamp } = s
  const cols = job.grid.cols
  const ui = u % cols
  const uj = (u - ui) / cols
  const base = scores[u] ?? 0

  for (let d = 0; d < STEP_DI.length; d++) {
    const di = STEP_DI[d] ?? 0
    const dj = STEP_DJ[d] ?? 0
    const v = u + dj * cols + di
    const isDiagonal = d >= STRAIGHT_STEPS

    if (walls[v] === 1 || (isDiagonal && (walls[u + di] === 1 || walls[u + dj * cols] === 1))) {
      continue
    }

    const score = base + (isDiagonal ? DIAGONAL : 1)

    if (seen[v] !== stamp || score < (scores[v] ?? 0)) {
      seen[v] = stamp
      scores[v] = score
      parent[v] = u
      pushHeap(s, v, score + octile(ui + di, uj + dj, job))
    }
  }
}

function octile(i: number, j: number, goal: Expansion): number {
  const dx = Math.abs(i - goal.goalI)
  const dy = Math.abs(j - goal.goalJ)

  return (dx > dy ? dx + OCTILE * dy : dy + OCTILE * dx) * HEURISTIC_WEIGHT
}

function toCells(parent: Int32Array, goal: number): number[] {
  const cells: number[] = []

  for (let v = goal; v !== -1; v = parent[v] ?? -1) {
    cells.push(v)
  }

  return cells.reverse()
}

// A binary min-heap over two parallel typed arrays (cells, costs) of `heapSize` entries.
function pushHeap(s: Scratch, cell: number, cost: number): void {
  const cells = s.heapCells
  const costs = s.heapCosts
  let k = s.heapSize

  s.heapSize++

  while (k > 0) {
    const p = (k - 1) >> 1
    const parentCost = costs[p] ?? 0

    if (parentCost <= cost) {
      break
    }

    cells[k] = cells[p] ?? 0
    costs[k] = parentCost
    k = p
  }

  cells[k] = cell
  costs[k] = cost
}

function popHeap(s: Scratch): number {
  const cells = s.heapCells
  const costs = s.heapCosts
  const top = cells[0] ?? 0
  const n = --s.heapSize
  const last = cells[n] ?? 0
  const lastCost = costs[n] ?? 0
  let k = 0

  for (let c = 1; c < n; c = 2 * k + 1) {
    const right = c + 1
    const child = right < n && (costs[right] ?? 0) < (costs[c] ?? 0) ? right : c
    const childCost = costs[child] ?? 0

    if (childCost >= lastCost) {
      break
    }

    cells[k] = cells[child] ?? 0
    costs[k] = childCost
    k = child
  }

  cells[k] = last
  costs[k] = lastCost

  return top
}
