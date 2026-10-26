import type { Tones } from '@/web/scene/sprites/palette'
import type { FloorId, Rect } from '@/web/scene/types'
import { FLOOR_TONES, WALL_TONES } from '@/web/scene/sprites/palette'
import { WORLD } from '@/web/scene/types'
import { DOORS, type Door } from '@/web/scene/world/doors'
import { DESK_SLOTS, FLOORS, type Wall } from '@/web/scene/world/floors'
import { type PropDef, propsOn } from '@/web/scene/world/props'
import { type RoomDef, roomsOn, WALL_BAND_PX } from '@/web/scene/world/rooms'

/** x, y, w, h in world pixels. */
type Box = readonly [number, number, number, number]

export const INK = '#2B2433'

const SHADOW = 'rgba(43,36,51,.16)'
const CONTACT = 'rgba(43,36,51,.18)'
const BASE_FILL = '#3A3F52'
const FACE_SHADE = 'rgba(43,36,51,.12)'
const GLASS_TINT = 'rgba(207,230,255,.16)'
const GLASS_SHINE = '#EAF4FC'
const MULLION_STEP = 32
const CORRIDOR_TOP = 192
const CORRIDOR_DEPTH = 32
const NORTH_GLASS_DEPTH = 28
const TILE_PX = 16
const PLANK_PX = 8
// The pale mat under each team desk, from the desk top's corner.
const DESK_MAT_INSET_X = 14
const DESK_MAT_RISE = 30
const DESK_MAT_W = 68
const DESK_MAT_H = 70
const DESK_MAT_TONES = ['#F1F2F5', '#DDE0E7'] as const
// Rugs under the meeting table, the operator's desk and the team's lounge, then the desk mats.
const RUGS: Readonly<Record<FloorId, readonly (readonly [Box, string, string])[]>> = Object.freeze({
  office: [
    [[416, 92, 192, 92], '#B9C5D2', '#97A6B6'],
    [[494, 272, 132, 100], '#D8C7A8', '#BCA886'],
    [[114, 262, 40, 16], '#E8D6BE', '#C9B79F'],
  ],
  team: [
    [[16, 92, 480, 284], '#E2E5EB', '#D7DBE2'],
    [[512, 180, 116, 96], '#C9D3DF', '#AFBCCB'],
    ...DESK_SLOTS.map(
      (slot) =>
        [
          [slot.x - DESK_MAT_INSET_X, slot.y - DESK_MAT_RISE, DESK_MAT_W, DESK_MAT_H],
          ...DESK_MAT_TONES,
        ] as const
    ),
  ],
})
// Wall-mounted pieces that never change: painted once into the cached floor.
const BAKED_KINDS: ReadonlySet<PropDef['kind']> = new Set(['shelf', 'ladder', 'books', 'window'])
const CORK_VARIANT = 3

export function fill(g: CanvasRenderingContext2D, box: Box, color: string): void {
  g.fillStyle = color
  g.fillRect(box[0], box[1], box[2], box[3])
}

/** A box with a one-pixel outline round it. */
export function framed(g: CanvasRenderingContext2D, box: Box, color: string): void {
  fill(g, [box[0] - 1, box[1] - 1, box[2] + 2, box[3] + 2], INK)
  fill(g, box, color)
}

/** A piece's cast shadow on the floor. */
export function castShadow(g: CanvasRenderingContext2D, box: Box): void {
  fill(g, box, SHADOW)
}

/** A box seen from the front and above: its top face `box` (x, y, w, depth), then a front face
 *  `front` px tall, a cast shadow and a contact shade where it meets the floor. */
export function drawBlock(
  g: CanvasRenderingContext2D,
  box: Box,
  look: { readonly front: number; readonly tones: Tones }
): void {
  const [x, y, w, d] = box
  const [light, mid, dark] = look.tones

  castShadow(g, [x + 2, y + d + look.front + 1, w, 3])
  fill(g, [x - 1, y - 1, w + 2, d + look.front + 2], INK)
  fill(g, [x, y, w, d], mid)
  fill(g, [x, y, w, 1], light)
  fill(g, [x, y + d, w, look.front], dark)
  fill(g, [x, y + d, w, 1], CONTACT)
}

/** Whether a prop is painted into the cached floor rather than every frame. */
export function isBaked(prop: PropDef): boolean {
  return BAKED_KINDS.has(prop.kind) || (prop.kind === 'frame' && prop.variant !== CORK_VARIANT)
}

/** The floor that never moves: surfaces, walls, glass, doorways, rugs and the baked props, drawn
 *  at one canvas pixel per world pixel. `paintProp` draws a baked prop. */
export function paintBuilding(
  g: CanvasRenderingContext2D,
  floor: FloorId,
  paintProp: (prop: PropDef) => void
): void {
  fill(g, [0, 0, WORLD.w, WORLD.h], BASE_FILL)

  for (const room of roomsOn(floor)) {
    paintSurface(g, room)
    paintWallFace(g, room.rect)

    if (room.rect.y === 0) {
      paintNorthGlass(g, room.rect)
    }
  }

  if (floor === 'office') {
    paintCorridor(g)
  }

  paintRugs(g, floor)
  paintWalls(g, FLOORS[floor].walls)
  paintDoorways(g, DOORS[floor])
  paintEdges(g, DOORS[floor])

  for (const prop of propsOn(floor).filter(isBaked)) {
    paintProp(prop)
  }
}

function paintSurface(g: CanvasRenderingContext2D, room: RoomDef): void {
  const tones: readonly string[] = FLOOR_TONES[room.surface]
  const { x, y, w, h } = room.rect
  const top = y + WALL_BAND_PX
  const [base = BASE_FILL, line = base, seam = line] = tones

  fill(g, [x, top, w, h - WALL_BAND_PX], base)

  if (room.surface === 'wood') {
    for (let row = top; row < y + h; row += PLANK_PX) {
      fill(g, [x, row + PLANK_PX - 1, w, 1], seam)

      for (
        let col = x + ((row / PLANK_PX) % 2 === 0 ? TILE_PX : 0);
        col < x + w;
        col += TILE_PX * 2
      ) {
        fill(g, [col, row, 1, PLANK_PX - 1], line)
      }
    }
    return
  }

  if (room.surface === 'tile') {
    paintGrid(g, { box: [x, top, w, h - WALL_BAND_PX], step: TILE_PX, color: line })
    return
  }

  paintSpeckle(g, [x, top, w, h - WALL_BAND_PX], line)
}

function paintGrid(
  g: CanvasRenderingContext2D,
  spec: { readonly box: Box; readonly step: number; readonly color: string }
): void {
  const [x, y, w, h] = spec.box

  for (let row = y; row < y + h; row += spec.step) {
    fill(g, [x, row, w, 1], spec.color)
  }

  for (let col = x; col < x + w; col += spec.step) {
    fill(g, [col, y, 1, h], spec.color)
  }
}

// A woven floor: one dot every few pixels, every other row offset.
function paintSpeckle(g: CanvasRenderingContext2D, box: Box, color: string): void {
  const [x, y, w, h] = box

  for (let row = y; row < y + h; row += 3) {
    for (let col = x + (row % 6 === 0 ? 0 : 2); col < x + w; col += 5) {
      fill(g, [col, row, 1, 1], color)
    }
  }
}

function paintWallFace(g: CanvasRenderingContext2D, rect: Rect): void {
  fill(g, [rect.x, rect.y, rect.w, WALL_BAND_PX], WALL_TONES.face)
  fill(g, [rect.x, rect.y + 20, rect.w, 12], WALL_TONES.low)
  fill(g, [rect.x, rect.y + 30, rect.w, 2], WALL_TONES.skirt)
  fill(g, [rect.x, rect.y, rect.w, 4], WALL_TONES.dark)
  fill(g, [rect.x, rect.y + WALL_BAND_PX, rect.w, 2], FACE_SHADE)
}

// The building's north wall is clear glass: a light tint, a frame and a mullion every two tiles.
function paintNorthGlass(g: CanvasRenderingContext2D, rect: Rect): void {
  g.clearRect(rect.x, 4, rect.w, NORTH_GLASS_DEPTH - 4)
  fill(g, [rect.x, 4, rect.w, NORTH_GLASS_DEPTH - 4], GLASS_TINT)
  fill(g, [rect.x, 0, rect.w, 4], WALL_TONES.frame)
  fill(g, [rect.x, NORTH_GLASS_DEPTH - 2, rect.w, 2], WALL_TONES.frame)

  for (let x = rect.x; x < rect.x + rect.w; x += MULLION_STEP) {
    fill(g, [x, 4, 2, NORTH_GLASS_DEPTH - 6], WALL_TONES.mullion)
    fill(g, [x + 2, 4, 1, NORTH_GLASS_DEPTH - 6], 'rgba(255,255,255,.35)')
  }
}

function paintCorridor(g: CanvasRenderingContext2D): void {
  fill(g, [0, CORRIDOR_TOP, WORLD.w, CORRIDOR_DEPTH], WALL_TONES.corridor)

  for (let x = 0; x < WORLD.w; x += TILE_PX) {
    fill(g, [x, CORRIDOR_TOP, 1, CORRIDOR_DEPTH], WALL_TONES.corridorLine)
  }
}

function paintRugs(g: CanvasRenderingContext2D, floor: FloorId): void {
  for (const [[x, y, w, h], inner, outer] of RUGS[floor]) {
    fill(g, [x, y, w, h], outer)
    fill(g, [x + 3, y + 3, w - 6, h - 6], inner)
  }
}

function paintWalls(g: CanvasRenderingContext2D, walls: readonly Wall[]): void {
  for (const wall of walls) {
    const isVertical = wall.from.x === wall.to.x
    const length = isVertical ? wall.to.y - wall.from.y : wall.to.x - wall.from.x
    const box: Box = isVertical
      ? [wall.from.x - 2, wall.from.y, 4, length]
      : [wall.from.x, wall.from.y - 2, length, 4]

    if (wall.kind === 'glass') {
      paintGlassWall(g, box)
    } else {
      fill(g, box, WALL_TONES.dark)
      fill(
        g,
        isVertical ? [box[0], box[1], 1, box[3]] : [box[0], box[1], box[2], 1],
        WALL_TONES.edge
      )
    }
  }
}

function paintGlassWall(g: CanvasRenderingContext2D, box: Box): void {
  const [x, y, w, h] = box

  fill(g, box, WALL_TONES.glass)
  fill(g, [x, y, w, 1], GLASS_SHINE)

  for (let at = x; at < x + w; at += MULLION_STEP) {
    fill(g, [at, y, 2, h], WALL_TONES.dark)
  }

  fill(g, [x + w - 2, y, 2, h], WALL_TONES.dark)
}

// A door in a room's north wall face is open to the corridor behind it, with a jamb each side.
function paintDoorways(g: CanvasRenderingContext2D, doors: readonly Door[]): void {
  for (const door of doors) {
    if (door.isWest === true || door.to !== undefined || door.at.y === CORRIDOR_TOP) {
      continue
    }

    fill(g, [door.at.x, door.at.y + 2, door.width, WALL_BAND_PX - 2], WALL_TONES.corridor)
    fill(g, [door.at.x - 2, door.at.y + 2, 2, WALL_BAND_PX - 2], WALL_TONES.dark)
    fill(g, [door.at.x + door.width, door.at.y + 2, 2, WALL_BAND_PX - 2], WALL_TONES.dark)
  }
}

// The east, west and south glass, with the west doorway left open.
function paintEdges(g: CanvasRenderingContext2D, doors: readonly Door[]): void {
  const west = doors.find((door) => door.isWest === true)
  const gapFrom = west?.at.y ?? WORLD.h
  const gapTo = west === undefined ? WORLD.h : west.at.y + west.width

  for (const [x, y, w, h] of [
    [0, WALL_BAND_PX, 3, gapFrom - WALL_BAND_PX],
    [0, gapTo, 3, WORLD.h - gapTo],
    [WORLD.w - 3, WALL_BAND_PX, 3, WORLD.h - WALL_BAND_PX],
    [0, WORLD.h - 3, WORLD.w, 3],
  ] satisfies Box[]) {
    fill(g, [x, y, w, h], GLASS_TINT)
    fill(g, w > h ? [x, y + h - 1, w, 1] : [x === 0 ? 0 : x + w - 1, y, 1, h], WALL_TONES.frame)
  }

  for (let y = WALL_BAND_PX; y < WORLD.h; y += MULLION_STEP) {
    if (y < gapFrom - 1 || y > gapTo + 1) {
      fill(g, [0, y, 3, 2], WALL_TONES.mullion)
    }

    fill(g, [WORLD.w - 3, y, 3, 2], WALL_TONES.mullion)
  }
}
