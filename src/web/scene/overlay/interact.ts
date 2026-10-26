import type { ActorId, Point, SimView } from '@/web/scene/types'
import {
  engage,
  type FocusDeps,
  followActor,
  frameFollow,
  leaveFocus,
  stepFocus,
} from '@/web/scene/overlay/actor-focus'
import { createMeeting, MEET_FLOOR } from '@/web/scene/overlay/meeting'
import { hoverObject } from '@/web/scene/overlay/object-tip'
import { keyedActor } from '@/web/scene/overlay/overlay'
import { createPinch, type Pinch } from '@/web/scene/overlay/pinch'
import {
  actorAt,
  clickAt,
  hoverAt,
  type PointerDeps,
  type PointerState,
  setHovered,
} from '@/web/scene/overlay/pointer'
import { closeMenu, menuActor } from '@/web/scene/overlay/radial-menu'
import { leaveRoom, panBy, stopFollow, view, zoomBy } from '@/web/scene/view'

/** A press that moves further than this is a drag, never a click. */
const DRAG_PX = 6
/** A touch held this long on a person opens their ring. */
const LONG_PRESS_MS = 550
// A wheel's travel per zoom step; a trackpad's small deltas add up to one.
const WHEEL_STEP_PX = 100
// Up and down pan this far; left and right step through the people.
const ARROW_PAN_PX = 48
const ARROW_PANS: Readonly<Record<string, number>> = Object.freeze({
  ArrowUp: ARROW_PAN_PX,
  ArrowDown: -ARROW_PAN_PX,
})
const ARROW_STEPS: Readonly<Record<string, 1 | -1>> = Object.freeze({
  ArrowLeft: -1,
  ArrowRight: 1,
})
const ENGAGE_KEYS: ReadonlySet<string> = new Set(['Enter', ' '])
const ESCAPE_KEY = 'Escape'
const TAB_KEY = 'Tab'
const TOUCH = 'touch'
const MOUSE = 'mouse'
const GRAB_CURSOR = 'grabbing'
const RING_SELECTOR = '.radial-menu'

/** The canvas's input on the scene's one loop: no timer of its own, its long-press and follow run
 *  on the sim step. */
export interface Interaction {
  step(nowMs: number): boolean
  /** A frame was drawn from `sim`: the follow camera keeps up with what it shows. */
  frame(sim: SimView): void
  nextDueAt(): number
  detach(): void
}

// One press from pointerdown to pointerup; a touch on a person may become a long-press, a Shift
// press on the meeting floor draws a box.
interface Press {
  readonly pointerId: number
  readonly startX: number
  readonly startY: number
  readonly pointerType: string
  readonly isShift: boolean
  readonly isBoxing: boolean
  readonly longPress?: { readonly actor: ActorId; readonly at: number }
  lastX: number
  lastY: number
  isDragging: boolean
  isFired: boolean
}

interface InputState extends PointerState {
  press: Press | undefined
  wheelPx: number
  readonly pinch: Pinch
  lastPointerType: string
}

/** The one owner of the canvas's pointer, wheel, key and focus listeners, all on one controller,
 *  and of the meeting picks: drag to pan, wheel to zoom, hover, clicks and long-presses on people,
 *  their ring, follow, Tab stepping and the meeting. `detach` releases every one of them. */
export function attachInteraction(canvas: HTMLCanvasElement, deps: PointerDeps): Interaction {
  const listeners = new AbortController()
  const focus: FocusDeps = {
    canvas,
    readView: deps.readView,
    director: deps.director,
    wake: deps.wake,
  }
  const meeting = createMeeting({ director: deps.director, wake: deps.wake })
  const input: InputState = {
    canvas,
    deps,
    focus,
    meeting,
    press: undefined,
    hovered: undefined,
    peeked: undefined,
    wheelPx: 0,
    pinch: createPinch({ canvas, renderer: deps.renderer }),
    lastPointerType: MOUSE,
  }

  listen(input, listeners.signal)

  return {
    step: (nowMs) => stepInput(input, nowMs),
    frame: (sim) => frameFollow(sim),
    nextDueAt: () => longPressDueOf(input.press),
    detach: () => {
      listeners.abort()
      endPress(input)
      input.pinch.clear()
      setHovered(input, undefined)
      leaveFocus(focus)
      closeMenu(false)
      stopFollow()
      meeting.dispose()
    },
  }
}

function listen(input: InputState, signal: AbortSignal): void {
  const { canvas } = input

  canvas.addEventListener('pointerdown', (event) => onDown(input, event), { signal })
  canvas.addEventListener('pointermove', (event) => onMove(input, event), { signal })
  canvas.addEventListener('pointerup', (event) => onUp(input, event), { signal })
  canvas.addEventListener('pointercancel', (event) => cancelPress(input, event), { signal })
  canvas.addEventListener('pointerleave', (event) => leaveCanvas(input, event), { signal })
  canvas.addEventListener('wheel', (event) => onWheel(input, event), { signal, passive: false })
  canvas.addEventListener('contextmenu', (event) => onContextMenu(input, event), { signal })
  canvas.addEventListener('dblclick', (event) => onDoubleClick(input, event), { signal })
  canvas.addEventListener('keydown', (event) => onKey(input, event), { signal })
  canvas.addEventListener('focus', () => onFocus(input), { signal })
  canvas.addEventListener('blur', (event) => onBlur(input, event), { signal })
}

// A touch held on a person opens their ring; a ring whose person left the floor shown closes.
function stepInput(input: InputState, nowMs: number): boolean {
  const { press } = input
  const sim = input.deps.readView()
  const isLong =
    press?.longPress !== undefined &&
    !press.isFired &&
    !press.isDragging &&
    nowMs >= press.longPress.at

  if (isLong) {
    press.isFired = true
    engage(input.focus, { actor: press.longPress.actor, isFocused: true, withMenu: true })
  }

  const open = menuActor.value

  if (
    open !== undefined &&
    !sim.actors.some((actor) => actor.id === open && actor.floor === sim.floor)
  ) {
    closeMenu(isFocusInRing())
  }

  return isLong
}

function longPressDueOf(press: Press | undefined): number {
  return press?.longPress === undefined || press.isFired || press.isDragging
    ? Number.POSITIVE_INFINITY
    : press.longPress.at
}

function onDown(input: InputState, event: PointerEvent): void {
  input.lastPointerType = event.pointerType

  if (event.button !== 0) {
    return
  }

  // A second finger turns the press into a pinch: the first neither clicks nor pans from here.
  if (input.pinch.down(event)) {
    endPress(input)
    return
  }

  const point = { x: event.offsetX, y: event.offsetY }
  const isBoxing = event.shiftKey && event.pointerType === MOUSE && view.value.floor === MEET_FLOOR
  const actor = event.pointerType === TOUCH ? actorAt(input, point) : undefined

  input.canvas.setPointerCapture(event.pointerId)
  input.press = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    pointerType: event.pointerType,
    isShift: event.shiftKey,
    isBoxing,
    ...(actor === undefined ? {} : { longPress: { actor, at: performance.now() + LONG_PRESS_MS } }),
    lastX: event.clientX,
    lastY: event.clientY,
    isDragging: false,
    isFired: false,
  }

  if (isBoxing) {
    input.meeting.startBox(point)
  }

  input.deps.wake()
}

function onMove(input: InputState, event: PointerEvent): void {
  const press = input.press

  if (input.pinch.move(event)) {
    return
  }

  if (press === undefined || press.pointerId !== event.pointerId) {
    if (event.pointerType !== TOUCH) {
      hoverAt(input, { x: event.offsetX, y: event.offsetY })
    }

    return
  }

  if (press.isBoxing) {
    input.meeting.moveBox({ x: event.offsetX, y: event.offsetY })
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

  input.pinch.lift(event.pointerId)

  if (press === undefined || press.pointerId !== event.pointerId) {
    return
  }

  const point = { x: event.offsetX, y: event.offsetY }
  const isBoxed =
    press.isBoxing &&
    input.meeting.endBox(input.deps.readView(), (at) => input.deps.renderer.toScreen(at))

  if (!(isBoxed || press.isDragging || press.isFired)) {
    clickAt(input, point, press)
  }

  endPress(input)
}

function cancelPress(input: InputState, event: PointerEvent): void {
  input.pinch.lift(event.pointerId)

  if (input.press?.isBoxing === true) {
    input.meeting.cancelBox()
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

// A right-click (or the browser's own long-press menu) on a person opens their ring instead.
function onContextMenu(input: InputState, event: MouseEvent): void {
  const actor = actorAt(input, { x: event.offsetX, y: event.offsetY })

  if (actor === undefined) {
    return
  }

  event.preventDefault()

  if (input.press?.isFired === true) {
    return
  }

  if (input.press !== undefined) {
    input.press.isFired = true
  }

  engage(input.focus, { actor, isFocused: true, withMenu: true })
}

// A double tap is two taps (the label, then the ring), never a follow.
function onDoubleClick(input: InputState, event: MouseEvent): void {
  if (input.lastPointerType === TOUCH) {
    return
  }

  const actor = actorAt(input, { x: event.offsetX, y: event.offsetY })

  if (actor !== undefined) {
    followActor(input.focus, actor)
  }
}

function onKey(input: InputState, event: KeyboardEvent): void {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return
  }

  const pan = ARROW_PANS[event.key]
  const step = ARROW_STEPS[event.key]
  const keyed = keyedActor.value

  if (pan !== undefined) {
    event.preventDefault()
    panBy(0, pan)
  } else if (step !== undefined) {
    event.preventDefault()
    stepFocus(input.focus, { by: step, isWrapping: true })
  } else if (event.key === TAB_KEY) {
    if (stepFocus(input.focus, { by: event.shiftKey ? -1 : 1, isWrapping: false })) {
      event.preventDefault()
    }
  } else if (ENGAGE_KEYS.has(event.key) && keyed !== undefined) {
    event.preventDefault()
    engage(input.focus, { actor: keyed, isFocused: true, withMenu: true })
  } else if (event.key === ESCAPE_KEY) {
    stepBack(input)
  }
}

// Esc lets go of one thing at a time: the ring, the picks and the meeting bar, a follow, then the
// room.
function stepBack(input: InputState): void {
  if (menuActor.value !== undefined) {
    closeMenu(false)
    return
  }

  if (input.meeting.clearPicks()) {
    return
  }

  if (view.value.follow !== undefined) {
    stopFollow()
    return
  }

  if (view.value.room !== undefined) {
    leaveRoom()
  }
}

// Reached by the keyboard, the canvas starts on its first person.
function onFocus(input: InputState): void {
  if (keyedActor.value === undefined && input.canvas.matches(':focus-visible')) {
    stepFocus(input.focus, { by: 1, isWrapping: false })
  }
}

// Focus moving into the person's ring keeps them; anywhere else lets go of them.
function onBlur(input: InputState, event: FocusEvent): void {
  const next = event.relatedTarget

  if (!(next instanceof Element && next.closest(RING_SELECTOR) !== null)) {
    closeMenu(false)
    leaveFocus(input.focus)
  }
}

function isFocusInRing(): boolean {
  return document.activeElement?.closest(RING_SELECTOR) != null
}

// A lifted finger leaves the canvas too; what its tap showed stays until the next tap.
function leaveCanvas(input: InputState, event: PointerEvent): void {
  if (event.pointerType === TOUCH) {
    return
  }

  hoverObject(undefined, { x: 0, y: 0 })
  setHovered(input, undefined)
}

function toWorldPoint(input: InputState, event: MouseEvent): Point {
  return input.deps.renderer.toWorld({ x: event.offsetX, y: event.offsetY })
}
