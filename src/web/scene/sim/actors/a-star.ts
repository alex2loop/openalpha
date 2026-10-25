import type { NavGrid } from '@/web/scene/world/nav-grid'

/** Cells from `start` to `goal`; `extra` marks more blocked cells (people). */
interface CellSearch {
  readonly grid: NavGrid
  readonly start: number
  readonly goal: number
  readonly extra?: Uint8Array
}

const NAV_MAX_NODES = 30_000
const DIAGONAL = Math.SQRT2
const OCTILE = Math.SQRT2 - 1
const DI = [1, -1, 0, 0, 1, 1, -1, -1] as const
const DJ = [0, 0, 1, -1, 1, -1, 1, -1] as const

/** Octile A* over 8 neighbours with no corner cutting: the cells from `start` to `goal`, or
 *  undefined when none is found within `NAV_MAX_NODES` expanded cells. */
export function aStar(search: CellSearch): number[] | undefined {
  const { grid, extra, start, goal } = search
  const size = grid.blocked.length
  const score = new Float32Array(size).fill(Number.POSITIVE_INFINITY)
  const parent = new Int32Array(size).fill(-1)
  const done = new Uint8Array(size)
  const open = createHeap()
  const heuristic = (cell: number): number => octile(grid, cell, goal)
  let expanded = 0

  score[start] = 0
  open.push(start, heuristic(start))

  for (let u = open.pop(); u !== undefined; u = open.pop()) {
    if (done[u] === 1) {
      continue
    }

    done[u] = 1

    if (u === goal) {
      return toCells(parent, goal)
    }

    if (++expanded > NAV_MAX_NODES) {
      return undefined
    }

    expand({ grid, extra, score, parent, open, heuristic }, u)
  }

  return undefined
}

interface Expansion {
  readonly grid: NavGrid
  readonly extra: Uint8Array | undefined
  readonly score: Float32Array
  readonly parent: Int32Array
  readonly open: Heap
  readonly heuristic: (cell: number) => number
}

function expand(job: Expansion, u: number): void {
  const { grid, score } = job
  const ui = u % grid.cols
  const uj = Math.floor(u / grid.cols)

  for (let d = 0; d < DI.length; d++) {
    const di = DI[d] ?? 0
    const dj = DJ[d] ?? 0
    const vi = ui + di
    const vj = uj + dj
    const v = vj * grid.cols + vi

    if (!isStepOpen(job, { ui, uj, vi, vj })) {
      continue
    }

    const g = (score[u] ?? 0) + (di !== 0 && dj !== 0 ? DIAGONAL : 1)

    if (g < (score[v] ?? Number.POSITIVE_INFINITY)) {
      score[v] = g
      job.parent[v] = u
      job.open.push(v, g + job.heuristic(v))
    }
  }
}

// Onto a free cell on the grid; a diagonal never cuts a blocked corner.
function isStepOpen(
  job: Expansion,
  step: { readonly ui: number; readonly uj: number; readonly vi: number; readonly vj: number }
): boolean {
  const { grid, extra } = job
  const { ui, uj, vi, vj } = step

  if (vi < 0 || vj < 0 || vi >= grid.cols || vj >= grid.rows) {
    return false
  }

  const isDiagonal = vi !== ui && vj !== uj
  const isCorner =
    isDiagonal &&
    (isBlockedCell(grid, uj * grid.cols + vi, extra) ||
      isBlockedCell(grid, vj * grid.cols + ui, extra))

  return !(isCorner || isBlockedCell(grid, vj * grid.cols + vi, extra))
}

function octile(grid: NavGrid, a: number, b: number): number {
  const dx = Math.abs((a % grid.cols) - (b % grid.cols))
  const dy = Math.abs(Math.floor(a / grid.cols) - Math.floor(b / grid.cols))

  return Math.max(dx, dy) + OCTILE * Math.min(dx, dy)
}

function toCells(parent: Int32Array, goal: number): number[] {
  const cells: number[] = []

  for (let v = goal; v !== -1; v = parent[v] ?? -1) {
    cells.push(v)
  }

  return cells.reverse()
}

interface Heap {
  push(item: number, priority: number): void
  pop(): number | undefined
}

// A binary min-heap of cells by priority.
function createHeap(): Heap {
  const items: number[] = []
  const priorities: number[] = []

  return {
    push(item, priority) {
      let k = items.length

      items.push(item)
      priorities.push(priority)

      while (k > 0) {
        const p = (k - 1) >> 1

        if ((priorities[p] ?? 0) <= priority) {
          break
        }

        items[k] = items[p] ?? 0
        priorities[k] = priorities[p] ?? 0
        k = p
      }

      items[k] = item
      priorities[k] = priority
    },
    pop: () => popHeap(items, priorities),
  }
}

function popHeap(items: number[], priorities: number[]): number | undefined {
  const top = items[0]
  const last = items.pop()
  const lastPriority = priorities.pop() ?? 0
  const n = items.length

  if (n === 0 || last === undefined) {
    return top
  }

  let k = 0

  for (let c = 1; c < n; c = 2 * k + 1) {
    if (c + 1 < n && (priorities[c + 1] ?? 0) < (priorities[c] ?? 0)) {
      c++
    }

    if ((priorities[c] ?? 0) >= lastPriority) {
      break
    }

    items[k] = items[c] ?? 0
    priorities[k] = priorities[c] ?? 0
    k = c
  }

  items[k] = last
  priorities[k] = lastPriority

  return top
}

export function isBlockedCell(grid: NavGrid, cell: number, extra?: Uint8Array): boolean {
  return grid.blocked[cell] === 1 || extra?.[cell] === 1
}
