import { type FloorId, type Point, type Rect, WORLD } from '@/web/scene/types'
import { setCapped } from '@/web/scene/world/capped-map'
import { DOORS } from '@/web/scene/world/doors'
import { FLOORS, type Wall } from '@/web/scene/world/floors'
import { isWallMounted, propsOn } from '@/web/scene/world/props'
import { roomsOn, WALL_BAND_PX } from '@/web/scene/world/rooms'

export const NAV_CELL_PX = 2
/** How far a person's feet keep from furniture and walls. */
export const NAV_CLEARANCE_PX = 4

/** The walkable cells of one floor: `blocked[cell]` is 1 where nobody may stand. */
export interface NavGrid {
  readonly cols: number
  readonly rows: number
  readonly blocked: Uint8Array
  /** The cell under `p`, or -1 off the grid. */
  cellOf(p: Point): number
  /** The centre of `cell`. */
  pointOf(cell: number): Point
}

const MAX_NAV_GRIDS = 8
// The grid reaches past the west wall to the porch outside the street door.
const GRID_ORIGIN_X = -12
const COLS = (WORLD.w - 2 * GRID_ORIGIN_X) / NAV_CELL_PX
const ROWS = WORLD.h / NAV_CELL_PX
// Nobody stands closer than this to the building's outer walls.
const FLOOR_EDGE_PX = 4
const WALL_HALF_PX = 2
// Wall pieces that stand on legs in the 3D layout: the whiteboards and the screens' stands.
const LEG_FEET: Readonly<Record<FloorId, readonly Rect[]>> = Object.freeze({
  office: [
    { x: 398, y: 80, w: 42, h: 3 },
    { x: 328, y: 82, w: 46, h: 3 },
    { x: 174, y: 281, w: 44, h: 3 },
    { x: 20, y: 275, w: 94, h: 3 },
    { x: 20, y: 325, w: 94, h: 3 },
  ],
  team: [],
} satisfies Record<FloorId, readonly Rect[]>)
const INTERIOR: Rect = Object.freeze({
  x: FLOOR_EDGE_PX,
  y: 0,
  w: WORLD.w - 2 * FLOOR_EDGE_PX,
  h: WORLD.h - FLOOR_EDGE_PX,
})

const grids = new Map<string, NavGrid>()

/** The floor's grid: walls less their doorways, every standing prop's footprint and `extra`
 *  (a moved cart, a new desk), each grown by the clearance. Memoised per floor and `extra`. */
export function navGridOf(floor: FloorId, extra: readonly Rect[] = []): NavGrid {
  const key = `${floor}:${extra.map((r) => `${r.x},${r.y},${r.w},${r.h}`).join(';')}`
  const held = grids.get(key)

  const grid = held ?? buildGrid(floor, extra)

  setCapped(grids, [key, grid], MAX_NAV_GRIDS)

  return grid
}

function buildGrid(floor: FloorId, extra: readonly Rect[]): NavGrid {
  const blocked = new Uint8Array(COLS * ROWS).fill(1)

  for (const rect of openRectsOf(floor)) {
    markRect(blocked, rect, 0)
  }

  for (const rect of [...blockRectsOf(floor), ...extra]) {
    markRect(blocked, grow(rect, NAV_CLEARANCE_PX), 1)
  }

  return {
    cols: COLS,
    rows: ROWS,
    blocked,
    cellOf: (p) => {
      const i = Math.floor((p.x - GRID_ORIGIN_X) / NAV_CELL_PX)
      const j = Math.floor(p.y / NAV_CELL_PX)

      return i < 0 || j < 0 || i >= COLS || j >= ROWS ? -1 : j * COLS + i
    },
    pointOf: (cell) => ({
      x: GRID_ORIGIN_X + ((cell % COLS) + 0.5) * NAV_CELL_PX,
      y: (Math.floor(cell / COLS) + 0.5) * NAV_CELL_PX,
    }),
  }
}

// Each room's floor below its wall band, the corridor, the doorways through the band, and the
// porch outside a west exit.
function openRectsOf(floor: FloorId): Rect[] {
  const def = FLOORS[floor]
  const inside: Rect[] = roomsOn(floor).map((room) => ({
    ...room.rect,
    y: room.rect.y + WALL_BAND_PX,
    h: room.rect.h - WALL_BAND_PX,
  }))
  const porches: Rect[] = []

  if (def.corridor !== undefined) {
    inside.push(def.corridor)
  }

  for (const door of DOORS[floor]) {
    if (door.isWest === true) {
      porches.push({
        x: GRID_ORIGIN_X,
        y: door.at.y,
        w: FLOOR_EDGE_PX - GRID_ORIGIN_X,
        h: door.width,
      })
    } else if (door.to === undefined) {
      inside.push({ x: door.at.x, y: door.at.y, w: door.width, h: WALL_BAND_PX })
    }
  }

  return [...inside.map((rect) => clip(rect, INTERIOR)), ...porches]
}

function blockRectsOf(floor: FloorId): Rect[] {
  const def = FLOORS[floor]
  const feet = propsOn(floor)
    .filter((prop) => !isWallMounted(prop))
    .map((prop) => prop.rect)

  return [...def.walls.map(toWallRect), ...feet, ...LEG_FEET[floor], def.lift]
}

function toWallRect(wall: Wall): Rect {
  const x = Math.min(wall.from.x, wall.to.x) - WALL_HALF_PX
  const y = Math.min(wall.from.y, wall.to.y) - WALL_HALF_PX

  return {
    x,
    y,
    w: Math.abs(wall.to.x - wall.from.x) + 2 * WALL_HALF_PX,
    h: Math.abs(wall.to.y - wall.from.y) + 2 * WALL_HALF_PX,
  }
}

// Sets every cell whose centre lies in `rect` (edges included).
function markRect(blocked: Uint8Array, rect: Rect, value: 0 | 1): void {
  const i0 = Math.max(0, Math.floor((rect.x - GRID_ORIGIN_X) / NAV_CELL_PX))
  const i1 = Math.min(COLS - 1, Math.floor((rect.x + rect.w - GRID_ORIGIN_X) / NAV_CELL_PX))
  const j0 = Math.max(0, Math.floor(rect.y / NAV_CELL_PX))
  const j1 = Math.min(ROWS - 1, Math.floor((rect.y + rect.h) / NAV_CELL_PX))

  for (let j = j0; j <= j1; j++) {
    const cy = (j + 0.5) * NAV_CELL_PX

    for (let i = i0; i <= i1; i++) {
      const cx = GRID_ORIGIN_X + (i + 0.5) * NAV_CELL_PX

      if (cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h) {
        blocked[j * COLS + i] = value
      }
    }
  }
}

function grow(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + 2 * by, h: rect.h + 2 * by }
}

function clip(rect: Rect, bounds: Rect): Rect {
  const x = Math.max(rect.x, bounds.x)
  const y = Math.max(rect.y, bounds.y)
  const right = Math.min(rect.x + rect.w, bounds.x + bounds.w)
  const bottom = Math.min(rect.y + rect.h, bounds.y + bounds.h)

  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) }
}
