import { signal } from '@preact/signals'

import type { ActorId, FloorId, Point, Rect, RoomId, Size } from '@/web/scene/types'

/** What both renderers frame at floor zoom: the floor plus the margin the 3D camera shows around
 *  it (the street to the sides and below, the sky over the north glass). */
export const FRAME_RECT: Rect = Object.freeze({ x: -112, y: -146, w: 864, h: 570 })
/** One zoom step multiplies the fitted floor's scale by this. */
export const ZOOM_STEP = 1.4
export const MAX_ZOOM_STEPS = 4

const INITIAL_FLOOR: FloorId = 'office'
const FRAME_CENTER: Point = Object.freeze({
  x: FRAME_RECT.x + FRAME_RECT.w / 2,
  y: FRAME_RECT.y + FRAME_RECT.h / 2,
})
// Under a world pixel of slack, an edge counts as reached.
const EDGE_SLACK_PX = 1
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
}

/** A thing to show: where it stands, and the room it stands in. */
interface ViewTarget {
  readonly floor: FloorId
  readonly rect: Rect
  readonly room?: { readonly id: RoomId; readonly rect: Rect }
}

/** The floor on screen, the room zoomed into when one is, and the shared camera: zoom steps above
 *  the fitted floor and the world point at the pane's centre. */
export const view = signal<SceneView>({ floor: INITIAL_FLOOR, zoomSteps: 0, center: FRAME_CENTER })
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
    held.originY === next.originY

  if (!isSame) {
    projection.value = next
  }
}

export function setFloor(floor: FloorId): void {
  noteInteraction()
  view.value = { floor, zoomSteps: 0, center: FRAME_CENTER }
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
  const next = Math.min(MAX_ZOOM_STEPS, Math.max(0, current + steps))

  if (next === current && held.room === undefined) {
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

/** Keeps the pane inside the frame; an axis the frame does not fill stays centred on it. */
export function clampPan(center: Point, scale: number, pane: Size): Point {
  return {
    x: clampAxis(center.x, [FRAME_RECT.x, FRAME_RECT.w], pane.w / 2 / scale),
    y: clampAxis(center.y, [FRAME_RECT.y, FRAME_RECT.h], pane.h / 2 / scale),
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

/** More of the frame lies that way (-1 left, 1 right) beyond the pane. */
export function canPanToward(dir: -1 | 1): boolean {
  const seen = visibleRect()

  return dir < 0
    ? seen.x > FRAME_RECT.x + EDGE_SLACK_PX
    : seen.x + seen.w < FRAME_RECT.x + FRAME_RECT.w - EDGE_SLACK_PX
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

function visibleRect(): Rect {
  const { pane, scale, originX, originY } = projection.value

  return { x: -originX / scale, y: -originY / scale, w: pane.w / scale, h: pane.h / scale }
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
