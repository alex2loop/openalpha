import type { SceneRenderer } from '@/web/scene/renderer'
import type { Point, ScreenPoint, SimView } from '@/web/scene/types'
import type { PropDef, TipSource } from '@/web/scene/world/props'
import { type Hit, pickAt } from '@/web/scene/overlay/hit'
import { hoverTextOf } from '@/web/scene/overlay/name-tags'
import { hoverObject, tipActionOf } from '@/web/scene/overlay/object-tip'
import { hoverActor, overlayView } from '@/web/scene/overlay/overlay'
import { openScreen } from '@/web/scene/overlay/screen-panel'
import { isActorId, ownAgentIdOf } from '@/web/scene/sim/actors/roster'
import { leaveRoom, panBy, view, zoomBy, zoomToRoom } from '@/web/scene/view'
import { propsOn } from '@/web/scene/world/props'
import { ROOM_IDS, roomById } from '@/web/scene/world/rooms'
import { selectActor } from '@/web/state/focus'
import { openView } from '@/web/state/panel'
import { toggleAllLamps, toggleLamp } from '@/web/state/prefs'
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
const PET_TIPS: readonly TipSource[] = Object.freeze(['cat', 'corgi'])
// The team floor is one room that fits: a click never zooms into it.
const TEAM_FLOOR = 'team'

interface InteractionDeps {
  readonly renderer: SceneRenderer
  /** The snapshot the last frame drew, which the hit test reads. */
  readonly readView: () => SimView
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
 *  pan, wheel to zoom (shift or a sideways swipe pans), arrows, Esc, and clicks on what the hit
 *  test finds: markers, people, lit screens, props, name tags and rooms.
 *  The returned function detaches every one of them. */
export function attachInteraction(canvas: HTMLCanvasElement, deps: InteractionDeps): () => void {
  const listeners = new AbortController()
  const { signal } = listeners
  const input: InputState = { canvas, deps, press: undefined, wheelPx: 0 }

  canvas.addEventListener('pointerdown', (event) => onDown(input, event), { signal })
  canvas.addEventListener('pointermove', (event) => onMove(input, event), { signal })
  canvas.addEventListener('pointerup', (event) => onUp(input, event), { signal })
  canvas.addEventListener('pointercancel', () => endPress(input), { signal })
  canvas.addEventListener('pointerleave', () => leaveCanvas(), { signal })
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
    click(input, { x: event.offsetX, y: event.offsetY })
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

// A marker, a person, a lit screen and a tag act where they stand, never moving the camera closer;
// a lamp or the wall switch acts at once; an object with somewhere to go goes there; from the
// floor view, a room zooms in.
function click(input: InputState, point: ScreenPoint): void {
  const hit = pickAt(point, input.deps.renderer, input.deps.readView())

  switch (hit?.kind) {
    case 'marker':
      overlayView.value.markers.find((held) => held.marker.actor === hit.id)?.marker.open()
      return
    case 'actor':
    case 'tag':
      selectActor(hit.id)
      openOwnAgent(input.deps.readView(), hit.id)
      return
    case 'screen':
      openLitScreen(hit.id)
      return
    case 'object':
      clickProp(propOf(hit))
      return
    case 'pet':
      tipActionOf(toPetTip(hit.id))?.()
      return
    case 'room':
      enterRoom(input, hit.id)
      return
    default:
      return
  }
}

// An own agent opens its desk in the panel; a child opens its parent's.
function openOwnAgent(sim: SimView, actor: string): void {
  const agentId =
    ownAgentIdOf(actor) ?? sim.team.kids.find((kid) => kid.actor === actor)?.parentAgentId

  if (agentId !== undefined) {
    openView({ agent: agentId })
  }
}

function openLitScreen(actor: string): void {
  const screen = overlayView.value.screens.find((held) => held.screen.actor === actor)?.screen

  if (screen !== undefined) {
    openScreen(screen)
  }
}

function clickProp(prop: PropDef | undefined): void {
  if (prop?.kind === 'lamp') {
    toggleLamp(prop.room)
    return
  }

  if (prop?.kind === 'light-switch') {
    toggleAllLamps(ROOM_IDS)
    return
  }

  tipActionOf(prop?.tip)?.()
}

function enterRoom(input: InputState, id: string): void {
  const isZoomable = view.value.room === undefined && view.value.floor !== TEAM_FLOOR
  const room = isZoomable ? ROOM_IDS.find((held) => held === id) : undefined
  const def = room === undefined ? undefined : roomById(room)

  if (def !== undefined) {
    zoomToRoom(def.id, def.rect)
    input.canvas.focus()
  }
}

function hover(input: InputState, event: PointerEvent): void {
  const screen: ScreenPoint = { x: event.offsetX, y: event.offsetY }
  const hit = pickAt(screen, input.deps.renderer, input.deps.readView())
  const prop = hit?.kind === 'object' ? propOf(hit) : undefined

  hoverObject(hit?.kind === 'pet' ? toPetTip(hit.id) : prop?.tip, screen)
  hoverActor(hit?.kind === 'actor' && isActorId(hit.id) ? hit.id : undefined)
  input.canvas.style.cursor = isClickable(hit, prop) ? CLICKABLE_CURSOR : ''
  input.canvas.title = hit?.kind === 'actor' ? actorTitleOf(input, hit.id) : switchTitleOf(prop)
}

// A person under the pointer is named with what their dot means, for the tooltip and readers.
function actorTitleOf(input: InputState, id: string): string {
  const actor = input.deps.readView().actors.find((each) => each.id === id)

  return actor === undefined ? '' : hoverTextOf(actor.id, actor.status)
}

function leaveCanvas(): void {
  hoverObject(undefined, { x: 0, y: 0 })
  hoverActor(undefined)
}

function isClickable(hit: Hit | undefined, prop: PropDef | undefined): boolean {
  switch (hit?.kind) {
    case undefined:
      return false
    case 'object':
      return prop !== undefined && (isSwitch(prop) || tipActionOf(prop.tip) !== undefined)
    case 'pet':
      return tipActionOf(toPetTip(hit.id)) !== undefined
    case 'room':
      return view.value.room === undefined && view.value.floor !== TEAM_FLOOR
    default:
      return true
  }
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

function toPetTip(id: string): TipSource | undefined {
  return PET_TIPS.find((tip) => tip === id)
}

function propOf(hit: Hit): PropDef | undefined {
  return propsOn(view.value.floor).find((prop) => prop.id === hit.id)
}

function toWorldPoint(input: InputState, event: MouseEvent): Point {
  return input.deps.renderer.toWorld({ x: event.offsetX, y: event.offsetY })
}
