import {
  CanvasTexture,
  LinearMipmapLinearFilter,
  Mesh,
  type MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three'

import type { FloorId, Point } from '@/web/scene/types'
import { type Box, box } from '@/web/scene/render3d/boxes'
import { toUnits, WALL_PX } from '@/web/scene/render3d/space'
import { FLOOR_TONES, WALL_TONES } from '@/web/scene/sprites/palette'
import { WORLD } from '@/web/scene/types'
import { HEIGHT_K } from '@/web/scene/view'
import { DOORS } from '@/web/scene/world/doors'
import { FLOORS, type Wall } from '@/web/scene/world/floors'
import { type RoomDef, roomAt, roomsOn, WALL_BAND_PX } from '@/web/scene/world/rooms'

/** The floor's building, by material: walls and frames, glass partitions, curtain glass, and the
 *  bottom-row rooms' north walls apart, so each can clear over someone it hides. */
interface BuildingBoxes {
  readonly solid: Box[]
  readonly glass: Box[]
  readonly curtain: Box[]
  readonly north: NorthWall[]
}

/** One north wall segment: its span along x, the z of its south face, and its boxes. */
interface NorthWall {
  readonly x0: number
  readonly x1: number
  readonly z0: number
  readonly boxes: Box[]
}

/** A north wall as drawn, with its own material, and how solid it shows now. */
export interface SeeThroughWall {
  readonly wall: NorthWall
  readonly material: MeshStandardMaterial
  opacity: number
}

const WALL_DEPTH = 4
const PARTITION_PX = 14
const PARTITION_CAP = 1.5
const GLASS_PARTITION_PX = 16
const POST_STEP_PX = 32
const POST_W = 2.5
const DOOR_PX = 30
const LOW_BAND_PX = 11
const SKIRT_PX = 2
const CAP_PX = 3
// Two faces of two colours never share a plane: a wall body stops this far under its cap, a
// band and a skirt stand proud of the face, glass ends inside its posts.
const UNDER_CAP_PX = 1.5
const PROUD_PX = 0.6
const GLASS_INSET_PX = 0.5
const FRAME_PX = 2.4
const MULLION_W = 2.2
const CURTAIN_PANE = 0.5
// The lobby's wall reads dark, as in 2D.
const LOBBY = 'lobby'
const LOBBY_FACE = '#2D3245'
const PLINTH = ['#DCCBB2', '#C4B199'] as const
const PLINTH_PX = 12
const FLOOR_TEXTURE_SCALE = 2
// A north wall clears to this while someone stands behind it: within the strip its full height
// hides on screen, and its span with a body's half width either side.
const SEE_THROUGH_OPACITY = 0.3
const HIDDEN_DEPTH_PX = WALL_PX * HEIGHT_K
const HIDDEN_MARGIN_PX = 6
const SEE_THROUGH_EASE_MS = 120
const SEE_THROUGH_SETTLED = 0.01
// A wall nearly solid writes depth again, so nothing behind it shows through.
const SOLID_FROM = 0.98
const ANISOTROPY = 8
const SEAM_STEP: Readonly<Record<RoomDef['surface'], number>> = Object.freeze({
  wood: 8,
  carpet: 0,
  lilac: 16,
  tile: 16,
  concrete: 32,
})

export function buildingBoxes(floor: FloorId): BuildingBoxes {
  const out: BuildingBoxes = { solid: [], glass: [], curtain: [], north: [] }
  const tops = new Set(
    roomsOn(floor)
      .filter((room) => room.rect.y > 0)
      .map((room) => room.rect.y)
  )

  for (const wall of FLOORS[floor].walls) {
    if (wall.from.x === wall.to.x) {
      partition(out, wall)
    } else if (tops.has(wall.from.y) && wall.kind === 'solid') {
      northWall(out, wall, floor)
    } else {
      corridorWall(out, wall)
    }
  }

  lintels(out, floor, tops)
  curtains(out, floor)
  out.solid.push(box([-6, 26, WORLD.w + 12, WORLD.h - 16, -PLINTH_PX, PLINTH_PX], PLINTH[0]))
  out.solid.push(box([-6, WORLD.h + 6, WORLD.w + 12, 4.4, -PLINTH_PX, 3], PLINTH[1]))

  return out
}

// A bottom-row room's north wall stands at the foot of its 2D wall band, full height.
function northWall(out: BuildingBoxes, wall: Wall, floor: FloorId): void {
  const z0 = wall.from.y + WALL_BAND_PX
  const x = wall.from.x
  const w = wall.to.x - wall.from.x
  const isLobby = roomAt(floor, { x, y: z0 })?.id === LOBBY

  out.north.push({
    x0: x,
    x1: x + w,
    z0,
    boxes: [
      box(
        [x, z0 - WALL_DEPTH, w, WALL_DEPTH, 0, WALL_PX - UNDER_CAP_PX],
        isLobby ? LOBBY_FACE : WALL_TONES.face
      ),
      box(
        [x, z0 - WALL_DEPTH, w, WALL_DEPTH + PROUD_PX, 0, LOW_BAND_PX],
        isLobby ? LOBBY_FACE : WALL_TONES.low
      ),
      box([x, z0 - WALL_DEPTH, w, WALL_DEPTH + PROUD_PX * 2, 0, SKIRT_PX], WALL_TONES.dark),
      box([x, z0 - WALL_DEPTH - 1, w, WALL_DEPTH + 2, WALL_PX - CAP_PX, CAP_PX], WALL_TONES.dark),
    ],
  })
}

// Over each doorway of a bottom-row wall, the wall carries on above the door, on two jambs.
function lintels(out: BuildingBoxes, floor: FloorId, tops: ReadonlySet<number>): void {
  for (const door of DOORS[floor]) {
    if (!tops.has(door.at.y) || door.to !== undefined || door.width === 0) {
      continue
    }

    const z0 = door.at.y + WALL_BAND_PX
    const { x } = door.at

    out.solid.push(
      box(
        [x, z0 - WALL_DEPTH, door.width, WALL_DEPTH, DOOR_PX, WALL_PX - DOOR_PX - UNDER_CAP_PX],
        WALL_TONES.face
      )
    )
    out.solid.push(
      box(
        [x, z0 - WALL_DEPTH - 1, door.width, WALL_DEPTH + 2, WALL_PX - CAP_PX, CAP_PX],
        WALL_TONES.dark
      )
    )
    out.solid.push(
      box([x - 2, z0 - WALL_DEPTH - 1, 2, WALL_DEPTH + 2, 0, DOOR_PX], WALL_TONES.dark)
    )
    out.solid.push(
      box([x + door.width, z0 - WALL_DEPTH - 1, 2, WALL_DEPTH + 2, 0, DOOR_PX], WALL_TONES.dark)
    )
  }
}

// The corridor's north side: low glass between posts, or a low solid partition.
function corridorWall(out: BuildingBoxes, wall: Wall): void {
  const { y } = wall.from
  const xa = wall.from.x
  const xb = wall.to.x

  if (wall.kind === 'solid') {
    out.solid.push(box([xa, y - 2, xb - xa, 4, 0, PARTITION_PX], WALL_TONES.dark))
    out.solid.push(box([xa, y - 2.4, xb - xa, 4.8, PARTITION_PX, PARTITION_CAP], WALL_TONES.edge))
    return
  }

  out.glass.push(
    box(
      [xa + GLASS_INSET_PX, y - 2, xb - xa - GLASS_INSET_PX * 2, 4, 0, GLASS_PARTITION_PX],
      WALL_TONES.glass
    )
  )

  for (let x = xa; x < xb; x += POST_STEP_PX) {
    out.solid.push(box([x, y - 2.4, POST_W, 4.8, 0, GLASS_PARTITION_PX + 1], WALL_TONES.dark))
  }

  out.solid.push(
    box([xb - POST_W, y - 2.4, POST_W, 4.8, 0, GLASS_PARTITION_PX + 1], WALL_TONES.dark)
  )
}

// A side wall between rooms: a low partition from the foot of the wall band down.
function partition(out: BuildingBoxes, wall: Wall): void {
  const { x } = wall.from
  const za = wall.from.y + WALL_BAND_PX
  const zb = wall.to.y

  out.solid.push(box([x - 2, za, 4, zb - za, 0, PARTITION_PX], WALL_TONES.dark))
  out.solid.push(box([x - 2.4, za, 4.8, zb - za, PARTITION_PX, PARTITION_CAP], WALL_TONES.edge))
}

// The outer walls are full-height glass: a slim frame at the floor and the ceiling line, thin
// mullions every two tiles; the west glass leaves its doorways open.
function curtains(out: BuildingBoxes, floor: FloorId): void {
  const top = WALL_BAND_PX
  const z0 = top - WALL_DEPTH

  out.solid.push(box([0, z0, WORLD.w, WALL_DEPTH, 0, FRAME_PX], WALL_TONES.frame))
  out.solid.push(box([0, z0, WORLD.w, WALL_DEPTH, WALL_PX - FRAME_PX, FRAME_PX], WALL_TONES.frame))
  out.curtain.push(
    box([0, top - 2.2, WORLD.w, CURTAIN_PANE, FRAME_PX, WALL_PX - FRAME_PX * 2], WALL_TONES.glass)
  )

  for (let x = 0; x <= WORLD.w; x += POST_STEP_PX) {
    const mx = Math.min(WORLD.w - MULLION_W, Math.max(0, x - MULLION_W / 2))

    out.solid.push(
      box([mx, z0 + 0.4, MULLION_W, WALL_DEPTH - 0.8, 0, WALL_PX - 1.2], WALL_TONES.mullion)
    )
  }

  const gaps = DOORS[floor].filter((door) => door.isWest === true)

  sideCurtain(out, { x: -WALL_DEPTH, gaps: gaps.map((door) => [door.at.y, door.width] as const) })
  sideCurtain(out, { x: WORLD.w, gaps: [] })
}

function sideCurtain(
  out: BuildingBoxes,
  side: { readonly x: number; readonly gaps: readonly (readonly [number, number])[] }
): void {
  const za = WALL_BAND_PX
  const zb = WORLD.h

  out.solid.push(box([side.x, za, WALL_DEPTH, zb - za, 0, FRAME_PX], WALL_TONES.frame))
  out.solid.push(
    box([side.x, za, WALL_DEPTH, zb - za, WALL_PX - FRAME_PX, FRAME_PX], WALL_TONES.frame)
  )

  for (let z = za; z <= zb; z += POST_STEP_PX) {
    out.solid.push(
      box(
        [side.x + 0.2, Math.min(z, zb - MULLION_W), WALL_DEPTH - 0.4, MULLION_W, 0, WALL_PX - 1.2],
        WALL_TONES.mullion
      )
    )
  }

  let from = za

  for (const [gz, gw] of [...side.gaps, [zb, 0] as const]) {
    if (gz > from) {
      out.curtain.push(
        box(
          [side.x + 1.7, from, CURTAIN_PANE, gz - from, FRAME_PX, WALL_PX - FRAME_PX * 2],
          WALL_TONES.glass
        )
      )
    }

    from = gz + gw
  }
}

/** Eases each north wall toward `SEE_THROUGH_OPACITY` while it hides someone standing behind it,
 *  and back to solid once they leave; true while one still changes. */
export function syncSeeThrough(
  walls: readonly SeeThroughWall[],
  spec: {
    readonly people: readonly { readonly at: Point }[]
    readonly dtMs: number
    readonly isReduced: boolean
  }
): boolean {
  const k = spec.isReduced ? 1 : 1 - Math.exp(-spec.dtMs / SEE_THROUGH_EASE_MS)
  let isChanged = false

  for (const one of walls) {
    const target = spec.people.some(({ at }) => isHiddenBy(one.wall, at)) ? SEE_THROUGH_OPACITY : 1
    const eased = one.opacity + (target - one.opacity) * k
    const next = Math.abs(target - eased) < SEE_THROUGH_SETTLED ? target : eased

    if (next !== one.opacity) {
      one.opacity = next
      one.material.opacity = next
      one.material.depthWrite = next > SOLID_FROM
      isChanged = true
    }
  }

  return isChanged
}

/** The north wall a piece hangs on, by its left edge and the z of the wall's face. */
export function wallHolding<T extends { readonly wall: NorthWall }>(
  walls: readonly T[],
  piece: { readonly x: number; readonly wallZ: number }
): T | undefined {
  return walls.find(
    ({ wall }) => wall.z0 === piece.wallZ && piece.x >= wall.x0 && piece.x < wall.x1
  )
}

function isHiddenBy(wall: NorthWall, at: Point): boolean {
  return (
    at.x > wall.x0 - HIDDEN_MARGIN_PX &&
    at.x < wall.x1 + HIDDEN_MARGIN_PX &&
    at.y < wall.z0 &&
    at.y > wall.z0 - HIDDEN_DEPTH_PX
  )
}

/** The floor's surface: each room's own, the corridor between; mipmapped so a far floor never
 *  shimmers. The floor plane starts under the north glass. */
export function createFloorPlane(floor: FloorId, material: MeshStandardMaterial): Mesh {
  const texture = new CanvasTexture(paintFloor(floor))
  const geometry = new PlaneGeometry(toUnits(WORLD.w), toUnits(WORLD.h - WALL_BAND_PX))
  const uv = geometry.getAttribute('uv')

  for (let v = 0; v < uv.count; v++) {
    uv.setY(v, uv.getY(v) * (1 - WALL_BAND_PX / WORLD.h))
  }

  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearMipmapLinearFilter
  texture.anisotropy = ANISOTROPY
  material.map = texture
  material.needsUpdate = true

  const plane = new Mesh(geometry, material)

  plane.rotation.x = -Math.PI / 2
  plane.position.set(toUnits(WORLD.w / 2), 0, toUnits((WORLD.h + WALL_BAND_PX) / 2))

  return plane
}

function paintFloor(floor: FloorId): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  const g = canvas.getContext('2d')

  canvas.width = WORLD.w * FLOOR_TEXTURE_SCALE
  canvas.height = WORLD.h * FLOOR_TEXTURE_SCALE

  if (g === null) {
    return canvas
  }

  g.scale(FLOOR_TEXTURE_SCALE, FLOOR_TEXTURE_SCALE)
  g.fillStyle = WALL_TONES.corridor
  g.fillRect(0, 0, WORLD.w, WORLD.h)

  for (const room of roomsOn(floor)) {
    paintSurface(g, room)
  }

  return canvas
}

function paintSurface(g: CanvasRenderingContext2D, room: RoomDef): void {
  const tones: readonly string[] = FLOOR_TONES[room.surface]
  const { x, y, w, h } = room.rect
  const step = SEAM_STEP[room.surface]

  g.fillStyle = tones[0] ?? WALL_TONES.corridor
  g.fillRect(x, y, w, h)

  if (step === 0) {
    return
  }

  g.fillStyle = tones[1] ?? WALL_TONES.corridorLine

  for (let row = y + step; row < y + h; row += step) {
    g.fillRect(x, row - 1, w, 1)
  }

  for (
    let col = x + (room.surface === 'wood' ? 0 : step);
    col < x + w && room.surface !== 'wood';
    col += step
  ) {
    g.fillRect(col - 1, y, 1, h)
  }
}
