import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  type Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
} from 'three'

import type { Box } from '@/web/scene/render3d/boxes'
import type { Materials } from '@/web/scene/render3d/lights'
import type { FloorProps } from '@/web/scene/render3d/props'
import type { CalendarView, DeskItemsView, FloorId, Rect, RoomId } from '@/web/scene/types'
import { box } from '@/web/scene/render3d/boxes'
import {
  createPool,
  endPool,
  type Pool,
  placeInstance,
  type Shapes,
} from '@/web/scene/render3d/instancing'
import { toUnits } from '@/web/scene/render3d/space'
import {
  CALENDAR_CELL,
  createDeskAtlas,
  DESK_ATLAS,
  type DeskAtlas,
  deskFaceCellOf,
} from '@/web/scene/sprites/desk-items'
import {
  CUP_LOOK,
  DESK_FACES,
  DESK_SHAPES,
  LAMP_DOME,
  NOTE_LOOK,
  SHEET_LOOK,
  sheetTurnOf,
  toneOf,
} from '@/web/scene/sprites/desk-looks'
import {
  DESK_FLOOR,
  DESK_PROPS,
  type DeskProp,
  deskSlotOf,
  isPinned,
} from '@/web/scene/world/desk-props'
import { DESK_SLOTS, TEAM_FLOOR } from '@/web/scene/world/floors'
import { roomAt } from '@/web/scene/world/rooms'

/** The desk pieces that change while the floor shows: the faces on one atlas mesh, and the cups,
 *  sheets, notes and the alert lamp's dome as instances of one box. */
export interface DeskItems {
  readonly atlas: DeskAtlas
  readonly texture: CanvasTexture
  readonly faces: Mesh<BufferGeometry, MeshBasicMaterial>
  readonly pool: Pool
  /** Which faces the mesh holds: the office's, the team floor's calendar at a slot, or none. */
  faceKey: string | undefined
  /** The signature the instances were placed for. */
  placed: number | undefined
}

/** What the desk pieces follow this frame. */
interface DeskFrame {
  readonly floor: FloorId
  readonly props: FloorProps | undefined
  readonly view: DeskItemsView
  readonly detail: number
  readonly calendar: CalendarView | undefined
}

/** A face's quad: its corners in world px and the atlas cell it shows. */
interface Quad {
  readonly x: readonly [number, number]
  readonly y: readonly [number, number]
  readonly z: readonly [number, number]
  readonly isUpright: boolean
  readonly cell: Rect
}

// Cups (each with its coffee), sheets, notes and the dome, all slots full.
const MAX_INSTANCES = 128
// A face stands this far proud of what it covers, so the two never share a plane.
const FACE_LIFT_PX = 0.05
// The team floor's calendar lies on the left of a desk top, from the desk's corner; the desk top
// stands this high.
const CALENDAR_AT = Object.freeze({ dx: 3, dz: -10.5, w: 8, d: 9, rise: 14 })
// A tab strip covers the monitor whose screen is within this of its spot.
const SCREEN_MATCH_PX = 3
const COFFEE = Object.freeze({ w: 1.4, h: 0.2 })
const QUAD_CORNERS = 4
const QUAD_INDICES = [0, 1, 2, 0, 2, 3] as const

export function createDeskItems(shapes: Shapes, materials: Materials, root: Group): DeskItems {
  const atlas = createDeskAtlas()
  const texture = new CanvasTexture(atlas.canvas)

  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.generateMipmaps = false

  const faces = new Mesh(
    new BufferGeometry(),
    new MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false })
  )
  const pool = createPool(shapes.box, materials.litI, { cap: MAX_INSTANCES })

  root.add(faces, pool.mesh)

  return { atlas, texture, faces, pool, faceKey: undefined, placed: undefined }
}

/** The static boxes of the floor's desk pieces, merged with the furniture of the room each stands
 *  in, so they cost no draw call. */
export function addDeskBoxes(rooms: Map<RoomId, Box[]>, floor: FloorId): void {
  if (floor !== DESK_FLOOR) {
    return
  }

  for (const row of DESK_PROPS) {
    const room = roomAt(floor, row.at)?.id
    const out = room === undefined ? undefined : rooms.get(room)

    for (const [dx, dz, w, d, rise, h, color] of DESK_SHAPES[row.type] ?? []) {
      out?.push(box([row.at.x + dx, row.at.y + dz, w, d, row.height + rise, h], color))
    }
  }
}

/** Builds the faces when the floor (or the calendar's desk) changes, repaints the atlas and
 *  re-places the instances when what the desks show changed; true when anything did. */
export function syncDeskItems(items: DeskItems, frame: DeskFrame): boolean {
  const isShown = frame.floor === DESK_FLOOR
  const calendar = frame.floor === TEAM_FLOOR ? frame.calendar : undefined
  const key = faceKeyOf(frame.floor, calendar)
  const isNewFaces = items.faceKey !== key

  if (isNewFaces) {
    items.faceKey = key
    items.placed = undefined
    items.faces.geometry.dispose()
    items.faces.geometry = isShown ? buildFaces(frame.props) : calendarFace(calendar)
  }

  items.faces.visible = key !== ''

  if (key === '') {
    items.pool.mesh.visible = false

    return isNewFaces
  }

  const isPainted = items.atlas.sync(frame.view, frame.detail, frame.calendar)

  if (isPainted) {
    items.texture.needsUpdate = true
  }

  if (!isShown) {
    items.pool.mesh.visible = false

    return isNewFaces || isPainted
  }

  return placeItems(items, frame.view) || isPainted || isNewFaces
}

export function disposeDeskItems(items: DeskItems): void {
  items.faces.removeFromParent()
  items.faces.geometry.dispose()
  items.faces.material.dispose()
  items.texture.dispose()
  items.atlas.release()
  items.pool.mesh.removeFromParent()
  items.pool.mesh.dispose()
}

function buildFaces(props: FloorProps | undefined): BufferGeometry {
  return geometryOf(
    DESK_PROPS.flatMap((row) => {
      const quad = quadOf(row, props)

      return quad === undefined ? [] : [quad]
    })
  )
}

function faceKeyOf(floor: FloorId, calendar: CalendarView | undefined): string {
  if (floor === DESK_FLOOR) {
    return DESK_FLOOR
  }

  return calendar === undefined ? '' : `${TEAM_FLOOR}:${calendar.slot}`
}

// The calendar lying on its desk top, its page towards the camera.
function calendarFace(calendar: CalendarView | undefined): BufferGeometry {
  const slot = calendar === undefined ? undefined : DESK_SLOTS[calendar.slot]

  if (slot === undefined) {
    return new BufferGeometry()
  }

  const x = slot.x + CALENDAR_AT.dx
  const z = slot.y + CALENDAR_AT.dz
  const y = CALENDAR_AT.rise + FACE_LIFT_PX

  return geometryOf([
    {
      x: [x, x + CALENDAR_AT.w],
      y: [y, y],
      z: [z, z + CALENDAR_AT.d],
      isUpright: false,
      cell: CALENDAR_CELL,
    },
  ])
}

function geometryOf(quads: readonly Quad[]): BufferGeometry {
  const position: number[] = []
  const uv: number[] = []
  const index: number[] = []

  quads.forEach((quad, i) => {
    writeQuad({ position, uv }, quad)
    index.push(...QUAD_INDICES.map((corner) => corner + i * QUAD_CORNERS))
  })

  const geometry = new BufferGeometry()

  geometry.setAttribute('position', new Float32BufferAttribute(position, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  geometry.setIndex(index)

  return geometry
}

// An upright face stands towards the camera; a flat one lies on the desk.
function quadOf(row: DeskProp, props: FloorProps | undefined): Quad | undefined {
  const cell = deskFaceCellOf(row)

  if (cell === undefined) {
    return undefined
  }

  if (row.type === 'tabs') {
    return tabQuadOf(row, { props, cell })
  }

  const spot = DESK_FACES[row.type]

  if (spot === undefined) {
    return undefined
  }

  const x0 = row.at.x + spot.dx
  const z0 = row.at.y + spot.dz
  const y0 = row.height + spot.rise + FACE_LIFT_PX
  const x: Quad['x'] = [x0, x0 + spot.w]

  return spot.isUpright
    ? {
        x,
        y: [y0, y0 + spot.size],
        z: [z0 + FACE_LIFT_PX, z0 + FACE_LIFT_PX],
        isUpright: true,
        cell,
      }
    : { x, y: [y0, y0], z: [z0, z0 + spot.size], isUpright: false, cell }
}

// A tab strip covers the front of its desk's monitor.
function tabQuadOf(
  row: DeskProp,
  at: { readonly props: FloorProps | undefined; readonly cell: Rect }
): Quad | undefined {
  const screen = at.props?.screens.find(
    ({ slot }) =>
      Math.abs(slot.x - row.at.x) <= SCREEN_MATCH_PX &&
      Math.abs(slot.y - row.at.y) <= SCREEN_MATCH_PX
  )

  if (screen === undefined) {
    return undefined
  }

  const [x, y, z] = screen.at
  const [w, h, d] = screen.size
  const up = { y: Math.cos(screen.tilt), z: Math.sin(screen.tilt) }
  const out = { y: -Math.sin(screen.tilt), z: Math.cos(screen.tilt) }
  const lift = d / 2 + FACE_LIFT_PX
  const front = { y: y + out.y * lift, z: z + out.z * lift }

  return {
    x: [x - w / 2, x + w / 2],
    y: [front.y - (up.y * h) / 2, front.y + (up.y * h) / 2],
    z: [front.z - (up.z * h) / 2, front.z + (up.z * h) / 2],
    isUpright: true,
    cell: at.cell,
  }
}

function writeQuad(out: { readonly position: number[]; readonly uv: number[] }, quad: Quad): void {
  const [x0, x1] = [toUnits(quad.x[0]), toUnits(quad.x[1])]
  const [y0, y1] = [toUnits(quad.y[0]), toUnits(quad.y[1])]
  const [z0, z1] = [toUnits(quad.z[0]), toUnits(quad.z[1])]
  const u0 = quad.cell.x / DESK_ATLAS.w
  const u1 = (quad.cell.x + quad.cell.w) / DESK_ATLAS.w
  const vTop = 1 - quad.cell.y / DESK_ATLAS.h
  const vBottom = 1 - (quad.cell.y + quad.cell.h) / DESK_ATLAS.h
  const corners = quad.isUpright
    ? [x0, y0, z0, x1, y0, z0, x1, y1, z1, x0, y1, z1]
    : [x0, y0, z0, x0, y0, z1, x1, y0, z1, x1, y0, z0]
  const uvs = quad.isUpright
    ? [u0, vBottom, u1, vBottom, u1, vTop, u0, vTop]
    : [u0, vTop, u0, vBottom, u1, vBottom, u1, vTop]

  out.position.push(...corners)
  out.uv.push(...uvs)
}

// Every cup and sheet the day left, the notes, and the dome in the alert's colour.
function placeItems(items: DeskItems, view: DeskItemsView): boolean {
  if (items.placed === view.signature) {
    return false
  }

  items.placed = view.signature
  items.pool.count = 0

  for (const row of DESK_PROPS) {
    placeRow(items.pool, { row, view })
  }

  endPool(items.pool)
  items.pool.mesh.visible = items.pool.count > 0

  return true
}

function placeRow(pool: Pool, at: { readonly row: DeskProp; readonly view: DeskItemsView }): void {
  const { row, view } = at
  const slot = deskSlotOf(row)
  const mess = view.mess.get(row.owner)
  const { x, y: z } = row.at

  if (row.type === 'cup' && slot < (mess?.cups ?? 0)) {
    placeCup(pool, { row, slot })
  } else if (row.type === 'sheet' && slot < (mess?.sheets ?? 0)) {
    placeSheet(pool, { row, slot })
  } else if (row.type === 'note') {
    placeNote(pool, { row, slot })
  } else if (row.type === 'lamp') {
    placeInstance(pool, {
      x: x + LAMP_DOME.dx + LAMP_DOME.w / 2,
      y: row.height + LAMP_DOME.rise + LAMP_DOME.h / 2,
      z: z + LAMP_DOME.dz + LAMP_DOME.w / 2,
      size: [LAMP_DOME.w, LAMP_DOME.h, LAMP_DOME.w],
      color: view.isAlertOn ? LAMP_DOME.on : LAMP_DOME.off,
    })
  }
}

// A cup in its slot's tone, its coffee showing at the top.
function placeCup(pool: Pool, at: { readonly row: DeskProp; readonly slot: number }): void {
  const { row, slot } = at
  const x = row.at.x + CUP_LOOK.w / 2
  const z = row.at.y + CUP_LOOK.w / 2

  placeInstance(pool, {
    x,
    y: row.height + CUP_LOOK.h / 2,
    z,
    size: [CUP_LOOK.w, CUP_LOOK.h, CUP_LOOK.w],
    color: toneOf(CUP_LOOK.tones, slot),
  })
  placeInstance(pool, {
    x,
    y: row.height + CUP_LOOK.h,
    z,
    size: [COFFEE.w, COFFEE.h, COFFEE.w],
    color: CUP_LOOK.coffee,
  })
}

// A sheet lies turned on the desk; a pinned one stands on its board, note-coloured.
function placeSheet(pool: Pool, at: { readonly row: DeskProp; readonly slot: number }): void {
  const { row, slot } = at

  if (isPinned(row)) {
    placeNote(pool, at)
    return
  }

  placeInstance(pool, {
    x: row.at.x + SHEET_LOOK.w / 2,
    y: row.height + SHEET_LOOK.h / 2,
    z: row.at.y + SHEET_LOOK.d / 2,
    size: [SHEET_LOOK.w, SHEET_LOOK.h, SHEET_LOOK.d],
    // Clockwise on screen is a negative turn about the up axis.
    yaw: -sheetTurnOf(slot),
    color: toneOf(SHEET_LOOK.tones, slot),
  })
}

function placeNote(pool: Pool, at: { readonly row: DeskProp; readonly slot: number }): void {
  const { row, slot } = at

  placeInstance(pool, {
    x: row.at.x + NOTE_LOOK.w / 2,
    y: row.height + NOTE_LOOK.h / 2,
    z: row.at.y,
    size: [NOTE_LOOK.w, NOTE_LOOK.h, NOTE_LOOK.d],
    color: toneOf(NOTE_LOOK.tones, slot),
  })
}
