import type { FloorId, Point, Rect, RoomId } from '@/web/scene/types'

/** How deep a room's north wall reads on the floor, from its top edge. */
export const WALL_BAND_PX = 32

type RoomSurface = 'concrete' | 'carpet' | 'wood' | 'tile' | 'lilac'

export interface RoomDef {
  readonly id: RoomId
  readonly floor: FloorId
  readonly rect: Rect
  readonly surface: RoomSurface
}

/** Every room, in the order spec 6.26 names them: the top row, then the bottom row; the corridor
 *  runs between the rows. */
export const ROOMS: readonly RoomDef[] = Object.freeze([
  { id: 'store', floor: 'office', rect: { x: 0, y: 0, w: 160, h: 192 }, surface: 'concrete' },
  { id: 'lib', floor: 'office', rect: { x: 160, y: 0, w: 224, h: 192 }, surface: 'carpet' },
  { id: 'meet', floor: 'office', rect: { x: 384, y: 0, w: 256, h: 192 }, surface: 'wood' },
  { id: 'lobby', floor: 'office', rect: { x: 0, y: 224, w: 160, h: 160 }, surface: 'tile' },
  { id: 'alerts', floor: 'office', rect: { x: 160, y: 224, w: 160, h: 160 }, surface: 'tile' },
  { id: 'assist', floor: 'office', rect: { x: 320, y: 224, w: 160, h: 160 }, surface: 'lilac' },
  { id: 'desk', floor: 'office', rect: { x: 480, y: 224, w: 160, h: 160 }, surface: 'wood' },
  { id: 'team', floor: 'team', rect: { x: 0, y: 0, w: 640, h: 384 }, surface: 'wood' },
] satisfies RoomDef[])

/** Every room's id; each room has one lamp, switched by its id. */
export const ROOM_IDS: readonly RoomId[] = Object.freeze(ROOMS.map((room) => room.id))

export function roomsOn(floor: FloorId): readonly RoomDef[] {
  return ROOMS.filter((room) => room.floor === floor)
}

export function roomById(id: RoomId): RoomDef | undefined {
  return ROOMS.find((room) => room.id === id)
}

/** The room a floor point stands in, if any; the corridor is in none. */
export function roomAt(floor: FloorId, p: Point): RoomDef | undefined {
  return ROOMS.find((room) => room.floor === floor && isInside(room.rect, p))
}

export function isInside(rect: Rect, p: Point): boolean {
  return p.x >= rect.x && p.x < rect.x + rect.w && p.y >= rect.y && p.y < rect.y + rect.h
}
