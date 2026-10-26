import type { FloorId, Point, Rect, RoomId } from '@/web/scene/types'

/** A wall line in world pixels; a solid wall hides what is behind it, glass does not. */
export interface Wall {
  readonly from: Point
  readonly to: Point
  readonly kind: 'solid' | 'glass'
}

interface FloorDef {
  readonly rooms: readonly RoomId[]
  readonly walls: readonly Wall[]
  readonly lift: Rect
  /** The open floor between the two rows of rooms, where the floor has one. */
  readonly corridor?: Rect
}

/** The own agents' floor, upstairs from the office. */
export const TEAM_FLOOR: FloorId = 'team'
/** The office's own floor, where the street door is and the lift parks. */
export const GROUND_FLOOR: FloorId = 'office'
// The corridor's north wall, with the store, library and meeting-room doorways left open.
const CORRIDOR_Y = 192
// The bottom row's north wall, with each room's door left open.
const BOTTOM_ROW_Y = 224
const TOP_ROW_BOTTOM = 192
const FLOOR_BOTTOM = 384

/** The team floor's six desks, one per own agent, in the order they are given out: each desk
 *  top's left corner. The lounge (shelves, sofa, coffee, water) fills the east side. */
export const DESK_SLOTS: readonly Point[] = Object.freeze([
  { x: 72, y: 156 },
  { x: 232, y: 156 },
  { x: 392, y: 156 },
  { x: 72, y: 286 },
  { x: 232, y: 286 },
  { x: 392, y: 286 },
])

export const FLOORS: Readonly<Record<FloorId, FloorDef>> = Object.freeze({
  office: {
    rooms: ['store', 'lib', 'meet', 'lobby', 'alerts', 'assist', 'desk'],
    walls: [
      horizontal(CORRIDOR_Y, [0, 64], 'glass'),
      horizontal(CORRIDOR_Y, [96, 160], 'solid'),
      horizontal(CORRIDOR_Y, [160, 256], 'glass'),
      horizontal(CORRIDOR_Y, [288, 496], 'glass'),
      horizontal(CORRIDOR_Y, [528, 640], 'glass'),
      horizontal(BOTTOM_ROW_Y, [0, 105], 'solid'),
      horizontal(BOTTOM_ROW_Y, [128, 168], 'solid'),
      horizontal(BOTTOM_ROW_Y, [192, 328], 'solid'),
      horizontal(BOTTOM_ROW_Y, [352, 584], 'solid'),
      horizontal(BOTTOM_ROW_Y, [608, 640], 'solid'),
      vertical(160, [0, TOP_ROW_BOTTOM]),
      vertical(384, [0, TOP_ROW_BOTTOM]),
      vertical(160, [BOTTOM_ROW_Y, FLOOR_BOTTOM]),
      vertical(320, [BOTTOM_ROW_Y, FLOOR_BOTTOM]),
      vertical(480, [BOTTOM_ROW_Y, FLOOR_BOTTOM]),
    ],
    lift: { x: 130, y: 226, w: 24, h: 30 },
    corridor: { x: 0, y: TOP_ROW_BOTTOM, w: 640, h: BOTTOM_ROW_Y - TOP_ROW_BOTTOM },
  },
  team: {
    rooms: ['team'],
    walls: [],
    lift: { x: 32, y: 220, w: 24, h: 30 },
  },
} satisfies Record<FloorId, FloorDef>)

/** The floor the lift takes someone on `floor` to. */
export function otherFloorOf(floor: FloorId): FloorId {
  return floor === TEAM_FLOOR ? GROUND_FLOOR : TEAM_FLOOR
}

function horizontal(y: number, span: readonly [number, number], kind: Wall['kind']): Wall {
  return { from: { x: span[0], y }, to: { x: span[1], y }, kind }
}

function vertical(x: number, span: readonly [number, number]): Wall {
  return { from: { x, y: span[0] }, to: { x, y: span[1] }, kind: 'solid' }
}
