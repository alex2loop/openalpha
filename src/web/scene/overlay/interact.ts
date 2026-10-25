import type { SceneRenderer } from '@/web/scene/renderer'
import type { Point, ScreenPoint } from '@/web/scene/types'
import { hoverObject, tipActionOf } from '@/web/scene/overlay/object-tip'
import { toggleAllLamps } from '@/web/scene/overlay/toolbar'
import { leaveRoom, panBy, view, zoomBy, zoomToRoom } from '@/web/scene/view'
import { type PropDef, propsOn } from '@/web/scene/world/props'
import { isInside, roomAt } from '@/web/scene/world/rooms'
import { toggleLamp } from '@/web/state/prefs'
import { tr } from '@/web/text/tr'

/** A press that moves further than this is a drag, never a click. */
const DRAG_PX = 6
// A wheel's travel per zoom step; a trackpad's small deltas add up to one.
const WHEEL_STEP_PX = 100
// One arrow key press pans this far.
const ARROW_PAN_PX = 48
const ARROW_PANS: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  ArrowLeft: [ARROW_PAN_PX, 0],
  ArrowRight: [-ARROW_PAN_PX, 0],
  ArrowUp: [0, ARROW_PAN_PX],
  ArrowDown: [0, -ARROW_PAN_PX],
})
const ESCAPE_KEY = 'Escape'
const CLICKABLE_CURSOR = 'pointer'
const GRAB_CURSOR = 'grabbing'

interface InteractionDeps {
  readonly renderer: SceneRenderer
}

// One press from pointerdown to pointerup.
interface Press {
  readonly pointerId: number
  readonly startX: number
  readonly startY: number
  lastX: number
  lastY: number
  isDragging: boolean
}

interface InputState {
  readonly canvas: HTMLCanvasElement
  readonly deps: InteractionDeps
  press: Press | undefined
  wheelPx: number
}

/** The one owner of the canvas's pointer, wheel and key listeners, all on one controller: drag to
 *  pan, wheel to zoom (shift or a sideways swipe pans), arrows, Esc, and clicks on props and rooms.
 *  The returned function detaches every one of them. */
export function attachInteraction(canvas: HTMLCanvasElement, deps: InteractionDeps): () => void {
  const listeners = new AbortController()
  const { signal } = listeners
  const input: InputState = { canvas, deps, press: undefined, wheelPx: 0 }

  canvas.addEventListener('pointerdown', (event) => onDown(input, event), { signal })
  canvas.addEventListener('pointermove', (event) => onMove(input, event), { signal })
  canvas.addEventListener('pointerup', (event) => onUp(input, event), { signal })
  canvas.addEventListener('pointercancel', () => endPress(input), { signal })
  canvas.addEventListener('pointerleave', () => hoverObject(undefined, { x: 0, y: 0 }), { signal })
  canvas.addEventListener('wheel', (event) => onWheel(input, event), { signal, passive: false })
  canvas.addEventListener('keydown', onKey, { signal })

  return () => {
    listeners.abort()
    endPress(input)
  }
}

function onDown(input: InputState, event: PointerEvent): void {
  if (event.button !== 0) {
    return
  }

  input.canvas.setPointerCapture(event.pointerId)
  input.press = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    isDragging: false,
  }
}

function onMove(input: InputState, event: PointerEvent): void {
  const press = input.press

  if (press === undefined || press.pointerId !== event.pointerId) {
    hover(input, event)
    return
  }

  if (
    !press.isDragging &&
    Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > DRAG_PX
  ) {
    press.isDragging = true
    input.canvas.style.cursor = GRAB_CURSOR
  }

  if (press.isDragging) {
    panBy(event.clientX - press.lastX, event.clientY - press.lastY)
  }

  press.lastX = event.clientX
  press.lastY = event.clientY
}

function onUp(input: InputState, event: PointerEvent): void {
  const press = input.press

  if (press === undefined || press.pointerId !== event.pointerId) {
    return
  }

  if (!press.isDragging) {
    click(input, toWorldPoint(input, event))
  }

  endPress(input)
}

function endPress(input: InputState): void {
  const press = input.press

  if (press !== undefined && input.canvas.hasPointerCapture(press.pointerId)) {
    input.canvas.releasePointerCapture(press.pointerId)
  }

  input.press = undefined
  input.canvas.style.cursor = ''
}

function onWheel(input: InputState, event: WheelEvent): void {
  event.preventDefault()

  const isSideways = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)

  if (isSideways) {
    panBy(-(event.shiftKey ? event.deltaY : event.deltaX), event.shiftKey ? 0 : -event.deltaY)
    return
  }

  input.wheelPx += event.deltaY

  if (Math.abs(input.wheelPx) < WHEEL_STEP_PX) {
    return
  }

  zoomBy(input.wheelPx < 0 ? 1 : -1, toWorldPoint(input, event))
  input.wheelPx = 0
}

function onKey(event: KeyboardEvent): void {
  const pan = ARROW_PANS[event.key]

  if (pan !== undefined) {
    event.preventDefault()
    panBy(pan[0], pan[1])
    return
  }

  if (event.key === ESCAPE_KEY && view.value.room !== undefined) {
    leaveRoom()
  }
}

// A lamp or the wall switch acts at once; an object with somewhere to go goes there; from the
// floor view, a room zooms in.
function click(input: InputState, at: Point): void {
  const prop = propAt(at)

  if (prop?.kind === 'lamp') {
    toggleLamp(prop.room)
    return
  }

  if (prop?.kind === 'light-switch') {
    toggleAllLamps()
    return
  }

  const go = prop === undefined ? undefined : tipActionOf(prop)

  if (go !== undefined) {
    go()
    return
  }

  const shown = view.value
  const room = shown.room === undefined ? roomAt(shown.floor, at) : undefined

  if (room !== undefined) {
    zoomToRoom(room.id, room.rect)
    input.canvas.focus()
  }
}

function hover(input: InputState, event: PointerEvent): void {
  const at = toWorldPoint(input, event)
  const prop = propAt(at)
  const screen: ScreenPoint = { x: event.offsetX, y: event.offsetY }
  const isClickable = prop !== undefined && (isSwitch(prop) || tipActionOf(prop) !== undefined)
  const isRoom = view.value.room === undefined && roomAt(view.value.floor, at) !== undefined

  hoverObject(prop, screen)
  input.canvas.style.cursor = isClickable || isRoom ? CLICKABLE_CURSOR : ''
  input.canvas.title = switchTitleOf(prop)
}

function isSwitch(prop: PropDef): boolean {
  return prop.kind === 'lamp' || prop.kind === 'light-switch'
}

function switchTitleOf(prop: PropDef | undefined): string {
  if (prop?.kind === 'lamp') {
    return tr('ui.office.lights.lamp')
  }

  return prop?.kind === 'light-switch' ? tr('ui.office.lights.switch') : ''
}

// The front-most prop under the point: the one standing lowest on the floor.
function propAt(at: Point): PropDef | undefined {
  return propsOn(view.value.floor)
    .filter((prop) => isInside(prop.rect, at))
    .sort((a, b) => b.sortY - a.sortY)[0]
}

function toWorldPoint(input: InputState, event: MouseEvent): Point {
  return input.deps.renderer.toWorld({ x: event.offsetX, y: event.offsetY })
}
