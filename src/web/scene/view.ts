import { signal } from '@preact/signals'

import type { SceneRenderer } from '@/web/scene/renderer'
import type { ActorId, FloorId, Point, Rect, RoomId, ScreenPoint, Size } from '@/web/scene/types'
import { WORLD } from '@/web/scene/types'

/** What both renderers frame at floor zoom: the floor plus the margin the 3D camera shows around
 *  it (the street to the sides and below, the sky over the north glass). */
export const FRAME_RECT: Rect = Object.freeze({ x: -112, y: -146, w: 864, h: 570 })
// How far the street runs past the frame: the side parks and the blocks beyond, the landmark's top,
// the south plaza.
const STREET_SIDE_PX = 480
const STREET_NORTH_PX = 154
const STREET_SOUTH_PX = 240
/** What the street canvas paints, and the farthest the camera pans once zoomed in. */
export const STREET_RECT: Rect = Object.freeze({
  x: FRAME_RECT.x - STREET_SIDE_PX,
  y: FRAME_RECT.y - STREET_NORTH_PX,
  w: FRAME_RECT.w + 2 * STREET_SIDE_PX,
  h: FRAME_RECT.h + STREET_NORTH_PX + STREET_SOUTH_PX,
})
export const STREET_BOTTOM = STREET_RECT.y + STREET_RECT.h
// The moving street canvas reaches this share of the visible rect past each of its sides, so a
// small pan between two steps stays inside it.
const MOVING_MARGIN = 0.25
/** The fixed 3D camera looks north and down at this angle. */
export const ELEVATION = (52 * Math.PI) / 180
/** A point this many px up shows `HEIGHT_K` times as far up the screen as a step north does, in
 *  3D and in the 2D street's facades alike. */
export const HEIGHT_K = Math.cos(ELEVATION) / Math.sin(ELEVATION)
/** One zoom step multiplies the fitted floor's scale by this. */
export const ZOOM_STEP = 1.4
/** The keys that zoom the focused canvas a step in or out. */
export const ZOOM_KEYS: Readonly<Record<string, 1 | -1>> = Object.freeze({
  '+': 1,
  '=': 1,
  '-': -1,
})
const MAX_ZOOM_STEPS = 5
// The 3D view zooms out at most this many steps below the fitted floor.
const MAX_ZOOM_OUT_STEPS = 4
/** The 3D view zooms no closer than this many device px per world px. */
export const MAX_ZOOM_3D_PX = 9.1

const INITIAL_FLOOR: FloorId = 'office'
const FLOOR_CENTER: Point = Object.freeze({ x: WORLD.w / 2, y: WORLD.h / 2 })
// Under a world pixel of slack, an edge counts as reached.
const EDGE_SLACK_PX = 1
// A step that lands within this share of a step from the cap counts as reaching it.
const ZOOM_SLACK = 0.01
// The camera follows a new run only after the operator has left it alone this long.
const FOLLOW_IDLE_MS = 10_000
// Following someone holds the camera at least this many zoom steps above the fitted floor.
const FOLLOW_ZOOM_STEPS = 2

interface SceneView {
  readonly floor: FloorId
  readonly room?: RoomId
  readonly zoomSteps: number
  readonly center: Point
  /** The person the camera keeps centred, across floors, until the operator moves it. */
  readonly follow?: ActorId
}

/** A person's feet on their floor. */
interface ActorPlace {
  readonly floor: FloorId
  readonly point: Point
}

/** What the mounted renderer shows: its pane in CSS px, CSS px per world px now and at the fitted
 *  floor, and where world (0, 0) lands in the pane. */
interface Projection {
  readonly pane: Size
  readonly scale: number
  readonly baseScale: number
  readonly originX: number
  readonly originY: number
  /** The closest the shown renderer zooms, CSS px per world px; absent, the steps run out first. */
  readonly maxScale?: number
  /** The farthest it zooms out, below the fitted floor; absent, it never goes below it. */
  readonly minScale?: number
}

/** A thing to show: where it stands, and the room it stands in. */
interface ViewTarget {
  readonly floor: FloorId
  readonly rect: Rect
  readonly room?: { readonly id: RoomId; readonly rect: Rect }
}

// The floor view the page opened at or the operator last chose; while the camera holds it, it keeps
// the floor centred as the pane or the floating panel changes.
let home: SceneView = { floor: INITIAL_FLOOR, zoomSteps: 0, center: FLOOR_CENTER }
// How far right of the floor's centre the home view looks, in world px, so the floor shows centred
// in the part of the pane the floating panel leaves clear.
let homeShift = 0

/** The floor on screen, the room zoomed into when one is, and the shared camera: zoom steps above
 *  the fitted floor and the world point at the pane's centre. */
export const view = signal<SceneView>(home)
/** Written by the renderer after a draw that moved the picture; overlays place themselves by it. */
export const projection = signal<Projection>({
  pane: { w: 0, h: 0 },
  scale: 1,
  baseScale: 1,
  originX: 0,
  originY: 0,
})

// When the operator last moved the camera (a `performance.now()` instant); the camera's own
// moves toward a run do not count.
let lastInteractionAt = Number.NEGATIVE_INFINITY

export function reportProjection(next: Projection): void {
  const held = projection.value
  const isSame =
    held.pane.w === next.pane.w &&
    held.pane.h === next.pane.h &&
    held.scale === next.scale &&
    held.baseScale === next.baseScale &&
    held.originX === next.originX &&
    held.originY === next.originY &&
    held.maxScale === next.maxScale &&
    held.minScale === next.minScale

  if (!isSame) {
    projection.value = next
  }
}

/** Where a floor point shows on the pane now. Reading the projection subscribes the caller, so a
 *  component placed by it follows every camera move, not only a change of its own props. */
export function placeOnPane(renderer: Pick<SceneRenderer, 'toScreen'>, p: Point): ScreenPoint {
  projection.value

  return renderer.toScreen(p)
}

export function setFloor(floor: FloorId): void {
  noteInteraction()
  home = { floor, zoomSteps: 0, center: { x: FLOOR_CENTER.x + homeShift, y: FLOOR_CENTER.y } }
  view.value = home
}

/** While the camera holds the home view, centres the floor in the part of `pane` left clear of
 *  `cover` CSS px on its right, at the fitted floor's `scale`. */
export function showHome(pane: Size, scale: number, cover: number): void {
  homeShift = cover / 2 / scale

  if (view.value !== home) {
    return
  }

  const center = clampPan({ x: FLOOR_CENTER.x + homeShift, y: FLOOR_CENTER.y }, scale, pane)

  if (center.x !== home.center.x || center.y !== home.center.y) {
    home = { ...home, center }
    view.value = home
  }
}

/** The one move that zooms into a room: a click on it or its tag from the floor view, or "Xem" on
 *  a narrow screen, which may name a room on another floor. */
export function zoomToRoom(room: RoomId, rect: Rect, floor: FloorId = view.value.floor): void {
  noteInteraction()
  showRoom(room, rect, floor)
}

export function leaveRoom(): void {
  setFloor(view.value.floor)
}

/** Moves the picture by `dx`, `dy` CSS px, as far as the frame goes; a follow ends. */
export function panBy(dx: number, dy: number): void {
  noteInteraction()

  const { follow: _ended, ...held } = view.value
  const { scale, pane } = projection.value
  const center = { x: held.center.x - dx / scale, y: held.center.y - dy / scale }

  view.value = { ...held, center: clampPan(center, scale, pane) }
}

/** Zooms by whole steps, keeping the world point `at` (the pointer) where it is. From a room the
 *  zoom carries on from the room's scale on the floor view. */
export function zoomBy(steps: number, at?: Point): void {
  noteInteraction()

  const held = view.value
  const { scale, baseScale, pane } = projection.value
  const current = held.room === undefined ? held.zoomSteps : stepsOf(scale / baseScale)
  const next = Math.min(maxZoomSteps(), Math.max(minZoomSteps(), current + steps))

  // At the limit nothing moves, but a zoom still ends a follow, as every other zoom does.
  if (next === current && held.room === undefined) {
    stopFollow()
    return
  }

  const nextScale = baseScale * ZOOM_STEP ** next
  const anchor = at ?? held.center
  const ratio = scale / nextScale
  const center = {
    x: anchor.x + (held.center.x - anchor.x) * ratio,
    y: anchor.y + (held.center.y - anchor.y) * ratio,
  }

  view.value = { floor: held.floor, zoomSteps: next, center: clampPan(center, nextScale, pane) }
}

/** The zoom steps above the fitted floor: all of them, or as many as reach the shown renderer's
 *  closest zoom. */
export function maxZoomSteps(): number {
  const { baseScale, maxScale } = projection.value

  if (maxScale === undefined || baseScale <= 0) {
    return MAX_ZOOM_STEPS
  }

  const reach = Math.ceil(Math.log(maxScale / baseScale) / Math.log(ZOOM_STEP) - ZOOM_SLACK)

  return Math.min(MAX_ZOOM_STEPS, Math.max(0, reach))
}

/** The zoom steps below the fitted floor: none in 2D; in 3D as far out as the renderer reaches, the
 *  last step landing on its farthest. */
export function minZoomSteps(): number {
  const { baseScale, minScale } = projection.value

  if (minScale === undefined || baseScale <= 0 || minScale >= baseScale) {
    return 0
  }

  const reach = Math.floor(Math.log(minScale / baseScale) / Math.log(ZOOM_STEP) + ZOOM_SLACK)

  return Math.max(-MAX_ZOOM_OUT_STEPS, Math.min(0, reach))
}

/** Keeps the pane inside the whole street at any zoom, as the mockup pans; an axis the street does
 *  not fill stays centred on it. */
export function clampPan(center: Point, scale: number, pane: Size): Point {
  return {
    x: clampAxis(center.x, [STREET_RECT.x, STREET_RECT.w], pane.w / 2 / scale),
    y: clampAxis(center.y, [STREET_RECT.y, STREET_RECT.h], pane.h / 2 / scale),
  }
}

/** Opening someone's panel moves the camera only when the target is on another floor or not wholly
 *  on screen, and then never closer than its room. */
export function bringIntoView(target: ViewTarget): void {
  const held = view.value

  if (target.floor !== held.floor) {
    view.value = { floor: target.floor, zoomSteps: 0, center: centerOf(target.rect) }
    return
  }

  if (isOnScreen(target.rect)) {
    return
  }

  if (held.room !== undefined && target.room !== undefined) {
    showRoom(target.room.id, target.room.rect)
    return
  }

  const { baseScale, pane } = projection.value
  const steps = stepsToFit(target.rect, held.zoomSteps)

  view.value = {
    floor: held.floor,
    zoomSteps: steps,
    center: clampPan(centerOf(target.rect), baseScale * ZOOM_STEP ** steps, pane),
  }
}

/** The camera keeps `actor` centred from here on, a little closer than the floor view; any move
 *  of the operator's own (a drag, a wheel, a zoom, a floor or a room) ends it. */
export function startFollow(actor: ActorId, at: ActorPlace): void {
  noteInteraction()

  const held = view.value
  const steps = Math.max(held.room === undefined ? held.zoomSteps : 0, FOLLOW_ZOOM_STEPS)

  view.value = {
    floor: at.floor,
    zoomSteps: steps,
    center: centerAt(at.point, steps),
    follow: actor,
  }
}

/** The followed person stands at `at` now: the camera takes their floor and centres on them. */
export function keepFollowing(at: ActorPlace): void {
  const held = view.value
  const center = centerAt(at.point, held.zoomSteps)

  if (
    held.follow === undefined ||
    (held.floor === at.floor && center.x === held.center.x && center.y === held.center.y)
  ) {
    return
  }

  view.value = { ...held, floor: at.floor, center }
}

export function stopFollow(): void {
  const { follow, ...held } = view.value

  if (follow !== undefined) {
    view.value = held
  }
}

/** Centres the picture on a point of the floor shown, at the zoom it holds; a follow ends. */
export function centerOn(point: Point): void {
  noteInteraction()

  const { follow: _ended, ...held } = view.value
  const { scale, pane } = projection.value

  view.value = { ...held, center: clampPan(point, scale, pane) }
}

/** The camera may follow a new run: the operator has not moved it for `FOLLOW_IDLE_MS`. */
export function canFollow(lastAt: number, now: number): boolean {
  return now - lastAt >= FOLLOW_IDLE_MS
}

export function readLastInteractionAt(): number {
  return lastInteractionAt
}

/** More of the pan range lies that way (-1 left, 1 right) beyond the pane. */
export function canPanToward(dir: -1 | 1): boolean {
  const seen = visibleRect()
  return dir < 0
    ? seen.x > STREET_RECT.x + EDGE_SLACK_PX
    : seen.x + seen.w < STREET_RECT.x + STREET_RECT.w - EDGE_SLACK_PX
}

function noteInteraction(): void {
  lastInteractionAt = performance.now()
}

function centerAt(point: Point, steps: number): Point {
  const { baseScale, pane } = projection.value

  return clampPan(point, baseScale * ZOOM_STEP ** steps, pane)
}

function showRoom(room: RoomId, rect: Rect, floor: FloorId = view.value.floor): void {
  view.value = { floor, room, zoomSteps: 0, center: centerOf(rect) }
}

// `span` is the frame's start and size on the axis, `half` half the pane on it in world px.
function clampAxis(center: number, span: readonly [number, number], half: number): number {
  const [start, size] = span

  if (size <= half * 2) {
    return start + size / 2
  }

  return Math.min(start + size - half, Math.max(start + half, center))
}

function isOnScreen(rect: Rect): boolean {
  const seen = visibleRect()

  return (
    rect.x >= seen.x &&
    rect.y >= seen.y &&
    rect.x + rect.w <= seen.x + seen.w &&
    rect.y + rect.h <= seen.y + seen.h
  )
}

/** The world rect under the shown renderer's pane, as its last draw placed it. */
export function visibleRect(): Rect {
  const { pane, scale, originX, originY } = projection.value

  return { x: -originX / scale, y: -originY / scale, w: pane.w / scale, h: pane.h / scale }
}

/** The visible rect with the moving street's margin, inside the street: where a street entity
 *  is drawn, and where it keeps the loop awake. */
export function movingRectOf(visible: Rect): Rect {
  const x0 = Math.max(STREET_RECT.x, visible.x - visible.w * MOVING_MARGIN)
  const y0 = Math.max(STREET_RECT.y, visible.y - visible.h * MOVING_MARGIN)
  const x1 = Math.min(STREET_RECT.x + STREET_RECT.w, visible.x + visible.w * (1 + MOVING_MARGIN))
  const y1 = Math.min(STREET_RECT.y + STREET_RECT.h, visible.y + visible.h * (1 + MOVING_MARGIN))

  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}

// The current zoom, stepped out until the target fits the pane.
function stepsToFit(rect: Rect, steps: number): number {
  const { baseScale, pane } = projection.value
  let fitted = steps

  while (
    fitted > 0 &&
    (rect.w * baseScale * ZOOM_STEP ** fitted > pane.w ||
      rect.h * baseScale * ZOOM_STEP ** fitted > pane.h)
  ) {
    fitted--
  }

  return fitted
}

function stepsOf(ratio: number): number {
  return ratio > 0 ? Math.round(Math.log(ratio) / Math.log(ZOOM_STEP)) : 0
}

function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
}
