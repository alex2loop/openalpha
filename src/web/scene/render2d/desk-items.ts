import type { CalendarView, DeskItemsView, FloorId, Point, Rect } from '@/web/scene/types'
import { INK } from '@/web/scene/render2d/building'
import {
  CALENDAR_CELL,
  createDeskAtlas,
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
  type ShapeBox,
  sheetTurnOf,
  toneOf,
} from '@/web/scene/sprites/desk-looks'
import { HEIGHT_K } from '@/web/scene/view'
import {
  DESK_FLOOR,
  DESK_PROPS,
  type DeskProp,
  deskSlotOf,
  isPinned,
} from '@/web/scene/world/desk-props'
import { TEAM_FLOOR } from '@/web/scene/world/floors'
import { type PropDef, type PropKind, propsOn } from '@/web/scene/world/props'
import { isInside } from '@/web/scene/world/rooms'

/** A rectangle to fill, in world px. */
interface Fill {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly color: string
}

/** How a desk top's floor depth and height map to the 2D picture: `y = base + k * depth - (height
 *  - top) * HEIGHT_K`, so pieces sit on the top the 2D desk draws. */
interface Surface2d {
  readonly base: number
  readonly k: number
  readonly top: number
}

/** A rectangle turned about its centre, in world px. */
interface Turned extends Fill {
  readonly turn: number
}

/** One piece as 2D draws it, worked out once: its fills, the turned sheets, the alert lamp's dome
 *  either way, its face, and its slot among its owner's cups, sheets or notes. */
interface Drawn {
  readonly row: DeskProp
  readonly slot: number
  readonly fills: readonly Fill[]
  readonly turned: readonly Turned[]
  readonly dome?: { readonly on: readonly Fill[]; readonly off: readonly Fill[] }
  readonly face?: { readonly cell: Rect; readonly at: Rect }
}

/** The pieces on one desk, or pinned on one board, painted in one go after it. */
interface Group {
  readonly sortY: number
  readonly drawn: readonly Drawn[]
}

const SUPPORT_KINDS: ReadonlySet<PropKind> = new Set(['desk', 'table', 'guest-desk'])
// A desk's and a table's front face, under the top 2D draws.
const DESK_FRONT_PX = 8
const FRONT_SHADE = 0.8
// The team floor's calendar lies on the left of a desk top, from the desk's top-left corner.
const CALENDAR_PX = Object.freeze({ dx: 3, dy: 1, w: 8, h: 10 })
const SHEET_SHADOW = 'rgba(43,36,51,.25)'
const SHEET_SHADOW_DROP = 0.6
// After the desk under them, before a person at the same depth.
const DESK_TIE = 1.5
const PINNED: Surface2d = Object.freeze({ base: 0, k: 1, top: 0 })
const SUPPORTS = propsOn(DESK_FLOOR).filter((prop) => SUPPORT_KINDS.has(prop.kind))
const TAB_ROWS = DESK_PROPS.filter((row) => row.type === 'tabs')
const GROUPS: readonly Group[] = buildGroups()
const NO_PIECES: readonly DeskPiece[] = []

/** The desk pieces' paint state: set each frame before the pieces draw. */
const held: Held = { g: undefined, view: undefined, atlas: undefined }
const PIECES: readonly DeskPiece[] = GROUPS.map((group) => ({
  sortY: group.sortY,
  tie: DESK_TIE,
  draw: () => paintGroup(group),
}))

interface Held {
  g: CanvasRenderingContext2D | undefined
  view: DeskItemsView | undefined
  atlas: DeskAtlas | undefined
}

interface DeskPiece {
  readonly sortY: number
  readonly tie: number
  readonly draw: () => void
}

/** The desk pieces of the floor shown, sorted among the furniture and the people; the faces'
 *  atlas is repainted first when what they show changed, also on the team floor while it carries
 *  the calendar. */
export function deskPiecesOf(
  g: CanvasRenderingContext2D,
  at: {
    readonly floor: FloorId
    readonly view: DeskItemsView
    readonly detail: number
    readonly calendar: CalendarView | undefined
  }
): readonly DeskPiece[] {
  const isCalendarShown = at.floor === TEAM_FLOOR && at.calendar !== undefined

  if (at.floor !== DESK_FLOOR && !isCalendarShown) {
    return NO_PIECES
  }

  held.atlas ??= createDeskAtlas()
  held.atlas.sync(at.view, at.detail, at.calendar)
  held.g = g
  held.view = at.view

  return at.floor === DESK_FLOOR ? PIECES : NO_PIECES
}

/** The calendar on the desk whose top-left corner is `desk`, cut from the atlas `deskPiecesOf`
 *  painted just before. */
export function paintCalendarAt(g: CanvasRenderingContext2D, desk: Point): void {
  const canvas = held.atlas?.canvas

  if (canvas === undefined) {
    return
  }

  const { x, y, w, h } = CALENDAR_CELL

  g.imageSmoothingEnabled = true
  g.drawImage(
    canvas,
    x,
    y,
    w,
    h,
    desk.x + CALENDAR_PX.dx,
    desk.y + CALENDAR_PX.dy,
    CALENDAR_PX.w,
    CALENDAR_PX.h
  )
  g.imageSmoothingEnabled = false
}

/** Frees the atlas when the renderer goes. */
export function releaseDeskItems(): void {
  held.atlas?.release()
  held.atlas = undefined
  held.g = undefined
  held.view = undefined
}

function paintGroup(group: Group): void {
  const { g, view, atlas } = held

  if (g === undefined || view === undefined || atlas === undefined) {
    return
  }

  for (const drawn of group.drawn) {
    if (isShown(drawn, view)) {
      paintDrawn(g, drawn, held)
    }
  }
}

function isShown(drawn: Drawn, view: DeskItemsView): boolean {
  const mess = view.mess.get(drawn.row.owner)

  if (drawn.row.type === 'cup') {
    return drawn.slot < (mess?.cups ?? 0)
  }

  if (drawn.row.type === 'sheet') {
    return drawn.slot < (mess?.sheets ?? 0)
  }

  return true
}

function paintDrawn(g: CanvasRenderingContext2D, drawn: Drawn, at: Held): void {
  const canvas = at.atlas?.canvas

  paintFills(g, drawn.fills)

  if (drawn.dome !== undefined) {
    paintFills(g, at.view?.isAlertOn === true ? drawn.dome.on : drawn.dome.off)
  }

  for (const sheet of drawn.turned) {
    g.save()
    g.translate(sheet.x, sheet.y)
    g.rotate(sheet.turn)
    g.fillStyle = sheet.color
    g.fillRect(-sheet.w / 2, -sheet.h / 2, sheet.w, sheet.h)
    g.restore()
  }

  if (drawn.face !== undefined && canvas !== undefined) {
    const { cell, at: to } = drawn.face

    g.imageSmoothingEnabled = true
    g.drawImage(canvas, cell.x, cell.y, cell.w, cell.h, to.x, to.y, to.w, to.h)
    g.imageSmoothingEnabled = false
  }
}

function paintFills(g: CanvasRenderingContext2D, fills: readonly Fill[]): void {
  for (const fill of fills) {
    g.fillStyle = fill.color
    g.fillRect(fill.x, fill.y, fill.w, fill.h)
  }
}

function yOf(surface: Surface2d, depth: number, height: number): number {
  return surface.base + surface.k * depth - (height - surface.top) * HEIGHT_K
}

// A group paints its pieces back to front.
function buildGroups(): Group[] {
  const groups = new Map<string, { sortY: number; drawn: Drawn[] }>()

  for (const row of DESK_PROPS.filter((one) => one.type !== 'tabs')) {
    const anchor = anchorOf(row)
    const surface = anchor === undefined ? PINNED : surfaceOf(anchor)
    const slot = deskSlotOf(row)
    const groupKey = anchor?.id ?? row.owner
    const sortY = anchor?.sortY ?? yOf(surface, row.at.y, row.height)
    const group = groups.get(groupKey) ?? { sortY, drawn: [] }

    group.sortY = Math.max(group.sortY, sortY)
    group.drawn.push(toDrawn(row, { slot, surface, anchor }))
    groups.set(groupKey, group)
  }

  return [...groups.values()].map((group) => ({
    sortY: group.sortY,
    drawn: group.drawn.sort((a, b) => a.row.at.y - b.row.at.y),
  }))
}

// The prop a piece belongs to in 2D: a pinned piece none, else its desk.
function anchorOf(row: DeskProp): PropDef | undefined {
  return isPinned(row) ? undefined : SUPPORTS.find((prop) => isInside(prop.rect, row.at))
}

/** A scout's browser strip over its computer's glass, standing or laid flat, as the mockup lays it
 *  on whichever screen the monitor shows; cut from the atlas `deskPiecesOf` painted this frame. */
export function paintTabsOn(g: CanvasRenderingContext2D, computer: PropDef, glass: Rect): void {
  const canvas = held.atlas?.canvas
  const row = TAB_ROWS.find((one) => isInside(computer.rect, one.at))
  const cell = row === undefined ? undefined : deskFaceCellOf(row)

  if (canvas === undefined || cell === undefined) {
    return
  }

  g.imageSmoothingEnabled = true
  g.drawImage(canvas, cell.x, cell.y, cell.w, cell.h, glass.x, glass.y, glass.w, glass.h)
  g.imageSmoothingEnabled = false
}

function toDrawn(
  row: DeskProp,
  at: { readonly slot: number; readonly surface: Surface2d; readonly anchor?: PropDef | undefined }
): Drawn {
  const { slot, surface } = at
  const face = faceOf(row, at)
  const fills = [
    ...(DESK_SHAPES[row.type] ?? []).flatMap((shape) => fillsOf(shape, { row, surface })),
    ...slotFills(row, at),
  ]
  const dome = row.type === 'lamp' ? domeOf(row, surface) : undefined

  return {
    row,
    slot,
    fills,
    turned: row.type === 'sheet' ? sheetOf(row, at) : [],
    ...(dome === undefined ? {} : { dome }),
    ...(face === undefined ? {} : { face }),
  }
}

function surfaceOf(desk: PropDef): Surface2d {
  const k = (desk.draw.h - DESK_FRONT_PX) / desk.rect.h

  return { base: desk.draw.y - desk.rect.y * k, k, top: desk.height }
}

// A cup in its slot's tone with its coffee, or a sticky note; sheets turn as they are painted.
function slotFills(
  row: DeskProp,
  at: { readonly slot: number; readonly surface: Surface2d }
): Fill[] {
  const { slot, surface } = at

  if (row.type === 'cup') {
    const tone = toneOf(CUP_LOOK.tones, slot)
    const top = yOf(surface, row.at.y, row.height + CUP_LOOK.h)

    return [
      ...fillsOf([0, 0, CUP_LOOK.w, CUP_LOOK.w, 0, CUP_LOOK.h, tone], { row, surface }),
      { x: row.at.x + 1, y: top + 1, w: 1, h: 1, color: CUP_LOOK.coffee },
    ]
  }

  if (row.type === 'note') {
    const tone = toneOf(NOTE_LOOK.tones, slot)
    const top = yOf(surface, row.at.y, row.height + NOTE_LOOK.h)

    return [{ x: row.at.x, y: top, w: NOTE_LOOK.w, h: NOTE_LOOK.h * HEIGHT_K, color: tone }]
  }

  return []
}

// A sheet lies turned on the desk over its shadow; on a board it is pinned upright, note-coloured.
function sheetOf(
  row: DeskProp,
  at: { readonly slot: number; readonly surface: Surface2d }
): Turned[] {
  const { slot, surface } = at
  const turn = sheetTurnOf(slot)

  if (isPinned(row)) {
    const color = toneOf(NOTE_LOOK.tones, slot)
    const y = yOf(surface, row.at.y, row.height + NOTE_LOOK.h / 2)

    return [
      { x: row.at.x + NOTE_LOOK.w / 2, y, w: NOTE_LOOK.w, h: NOTE_LOOK.h * HEIGHT_K, turn, color },
    ]
  }

  const color = toneOf(SHEET_LOOK.tones, slot)
  const x = row.at.x + SHEET_LOOK.w / 2
  const y = yOf(surface, row.at.y + SHEET_LOOK.d / 2, row.height + SHEET_LOOK.h)
  const size = { w: SHEET_LOOK.w, h: SHEET_LOOK.d * surface.k, turn }

  return [
    { x, y: y + SHEET_SHADOW_DROP, ...size, color: SHEET_SHADOW },
    { x, y, ...size, color },
  ]
}

// The alert lamp's dome, either colour, worked out once.
function domeOf(row: DeskProp, surface: Surface2d): NonNullable<Drawn['dome']> {
  const { dx, dz, w, rise, h } = LAMP_DOME

  return {
    on: fillsOf([dx, dz, w, w, rise, h, LAMP_DOME.on], { row, surface }),
    off: fillsOf([dx, dz, w, w, rise, h, LAMP_DOME.off], { row, surface }),
  }
}

// A box as 2D shows it: its top, then its front, a shade darker, below.
function fillsOf(
  shape: ShapeBox,
  at: { readonly row: DeskProp; readonly surface: Surface2d }
): Fill[] {
  const [dx, dz, w, d, rise, h, color] = shape
  const x = at.row.at.x + dx
  const top = yOf(at.surface, at.row.at.y + dz, at.row.height + rise + h)
  const depth = d * at.surface.k
  const front = h * HEIGHT_K

  return [
    { x, y: top, w, h: depth, color },
    { x, y: top + depth, w, h: front, color: shadeOf(color) },
  ]
}

function faceOf(
  row: DeskProp,
  at: { readonly surface: Surface2d; readonly anchor?: PropDef | undefined }
): Drawn['face'] {
  const cell = deskFaceCellOf(row)

  if (cell === undefined) {
    return undefined
  }

  const spot = DESK_FACES[row.type]

  if (spot === undefined) {
    return undefined
  }

  const x = row.at.x + spot.dx
  const y = yOf(at.surface, row.at.y + spot.dz, row.height + spot.rise)

  return spot.isUpright
    ? { cell, at: { x, y: y - spot.size * HEIGHT_K, w: spot.w, h: spot.size * HEIGHT_K } }
    : { cell, at: { x, y, w: spot.w, h: spot.size * at.surface.k } }
}

function shadeOf(hex: string): string {
  const channels = [1, 3, 5].map((i) =>
    Math.round(Number.parseInt(hex.slice(i, i + 2), 16) * FRONT_SHADE)
      .toString(16)
      .padStart(2, '0')
  )

  return hex.startsWith('#') && hex.length === 7 ? `#${channels.join('')}` : INK
}
