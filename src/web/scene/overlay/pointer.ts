import type { FocusDeps } from '@/web/scene/overlay/actor-focus'
import type { Meeting } from '@/web/scene/overlay/meeting'
import type { SceneRenderer } from '@/web/scene/renderer'
import type { Director } from '@/web/scene/sim/director'
import type { ActorId, ScreenPoint, SimView } from '@/web/scene/types'
import type { PropDef, TipSource } from '@/web/scene/world/props'
import type { WallClock } from '@/web/scene/world/regions'
import { pageNow } from '@/web/scene/clock/clock'
import { regionPack } from '@/web/scene/data/home'
import { engage } from '@/web/scene/overlay/actor-focus'
import { actorNowOf } from '@/web/scene/overlay/actor-state'
import { type Hit, pickAt } from '@/web/scene/overlay/hit'
import { hoverTextOf, personNameOf } from '@/web/scene/overlay/hover-label'
import { MEET_FLOOR, MEET_ROOM } from '@/web/scene/overlay/meeting'
import { hoverObject, tipActionOf } from '@/web/scene/overlay/object-tip'
import { hoverActor, keyedActor, overlayView } from '@/web/scene/overlay/overlay'
import { closeMenu } from '@/web/scene/overlay/radial-menu'
import { openScreen } from '@/web/scene/overlay/screen-panel'
import { isActorId } from '@/web/scene/sim/actors/roster'
import { toggleAllLamps, toggleLamp } from '@/web/scene/sim/lamps'
import { stopFollow, view, zoomToRoom } from '@/web/scene/view'
import { TEAM_FLOOR } from '@/web/scene/world/floors'
import { propsOn } from '@/web/scene/world/props'
import { ROOM_IDS, roomById } from '@/web/scene/world/rooms'
import { formatClock } from '@/web/text/time'
import { tr } from '@/web/text/tr'

/** The pointer type a finger reports. */
export const TOUCH = 'touch'
const CLICKABLE_CURSOR = 'pointer'
const PET_TIPS: readonly TipSource[] = Object.freeze(['cat', 'corgi'])
// The team floor is one room that fits: a click never zooms into it.

/** What the canvas's input reads and drives. */
export interface PointerDeps {
  readonly renderer: SceneRenderer
  /** The snapshot the last frame drew, which the hit test reads. */
  readonly readView: () => SimView
  readonly director: Director
  /** Something changed outside the sim: the loop draws and steps again. */
  readonly wake: () => void
}

/** The part of the canvas's input a click or a hover acts through. */
export interface PointerState {
  readonly canvas: HTMLCanvasElement
  readonly deps: PointerDeps
  readonly focus: FocusDeps
  readonly meeting: Meeting
  hovered: ActorId | undefined
  /** What the last touch tap showed the label or tip of; the next tap on it acts. */
  peeked: string | undefined
}

/** How a click was made: with Shift held, and by which kind of pointer. */
interface ClickPress {
  readonly isShift: boolean
  readonly pointerType: string
}

// A marker, a person, a lit screen and a tag act where they stand, never moving the camera closer;
// a lamp or the wall switch acts at once; an object with somewhere to go goes there; from the
// floor view, a room zooms in. A Shift-click picks a person for a meeting. The building crew and
// the wet-floor sign take no click.
export function clickAt(input: PointerState, point: ScreenPoint, press: ClickPress): void {
  const hit = pickAt(point, input.deps.renderer, input.deps.readView())

  if (isFirstTap(input, hit, press)) {
    peekAt(input, point, hit)
    return
  }

  switch (hit?.kind) {
    case 'marker':
      overlayView.value.markers.find((held) => held.marker.actor === hit.id)?.marker.open()
      return
    case 'actor':
    case 'tag':
      clickActor(input, hit.id, press)
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
    case 'crew':
    case 'sign':
      return
    default:
      clickFloor(input, hit, press)
      return
  }
}

// On a touch screen nothing is hover-only: the first tap on a person, or on a thing with a tip,
// shows its label or tip; a second tap on it acts (a person's ring), as a long-press does.
function isFirstTap(input: PointerState, hit: Hit | undefined, press: ClickPress): boolean {
  const key =
    press.pointerType === TOUCH && hit !== undefined && isPeekable(hit) ? peekKeyOf(hit) : undefined
  const isFirst = key !== undefined && key !== input.peeked

  input.peeked = isFirst ? key : undefined
  return isFirst
}

// A person and their tag are one thing to tap twice.
function peekKeyOf(hit: Hit): string {
  return `${hit.kind === 'tag' ? 'actor' : hit.kind}:${hit.id}`
}

function isPeekable(hit: Hit): boolean {
  switch (hit.kind) {
    case 'actor':
    case 'tag':
      return isActorId(hit.id)
    case 'pet':
      return toPetTip(hit.id) !== undefined
    case 'object':
      return propOf(hit)?.tip !== undefined
    default:
      return false
  }
}

// The tap stands in for the hover: the tip or label shows, and a person greets without the ring.
function peekAt(input: PointerState, point: ScreenPoint, hit: Hit | undefined): void {
  hoverAt(input, point)

  if ((hit?.kind === 'actor' || hit?.kind === 'tag') && isActorId(hit.id)) {
    setHovered(input, hit.id)
    engage(input.focus, { actor: hit.id, isFocused: false, withMenu: false })
  }
}

function clickActor(input: PointerState, id: string, press: ClickPress): void {
  if (!isActorId(id)) {
    return
  }

  if (press.isShift) {
    input.meeting.toggle(input.deps.readView(), id)
    return
  }

  engage(input.focus, { actor: id, isFocused: false, withMenu: true })
}

// Empty floor lets go of a follow and the ring; the meeting room offers the meeting bar, any other
// place drops the picks; from the floor view a room zooms in.
function clickFloor(input: PointerState, hit: Hit | undefined, press: ClickPress): void {
  stopFollow()
  closeMenu(false)

  if (press.pointerType === TOUCH) {
    hoverObject(undefined, { x: 0, y: 0 })
    setHovered(input, undefined)
  }

  if (hit?.id === MEET_ROOM && view.value.floor === MEET_FLOOR) {
    input.meeting.showHint()
  } else if (!press.isShift) {
    input.meeting.clearPicks()
  }

  if (hit?.kind === 'room') {
    enterRoom(input, hit.id)
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

function enterRoom(input: PointerState, id: string): void {
  const isZoomable = view.value.room === undefined && view.value.floor !== TEAM_FLOOR
  const room = isZoomable ? ROOM_IDS.find((held) => held === id) : undefined
  const def = room === undefined ? undefined : roomById(room)

  if (def !== undefined) {
    zoomToRoom(def.id, def.rect)
    input.canvas.focus()
  }
}

/** The pointer over the scene: an object's tip, a person's look and label, the cursor and the
 *  canvas's title. */
export function hoverAt(input: PointerState, screen: ScreenPoint): void {
  const hit = pickAt(screen, input.deps.renderer, input.deps.readView())
  const prop = hit?.kind === 'object' ? propOf(hit) : undefined
  const isPerson = hit?.kind === 'actor' || hit?.kind === 'crew'
  const actor = isPerson && isActorId(hit.id) ? hit.id : undefined

  hoverObject(hit?.kind === 'pet' ? toPetTip(hit.id) : prop?.tip, screen)
  setHovered(input, actor)
  input.canvas.style.cursor = isClickable(hit, prop) ? CLICKABLE_CURSOR : ''
  input.canvas.title = actor === undefined ? thingTitleOf(hit, prop) : actorTitleOf(input, actor)
}

// The person under the pointer looks up at it until the pointer leaves them.
export function setHovered(input: PointerState, actor: ActorId | undefined): void {
  const held = input.hovered

  if (held === actor) {
    return
  }

  if (held !== undefined) {
    input.deps.director.requestReaction(held, undefined)
  }

  if (actor !== undefined) {
    input.deps.director.requestReaction(actor, 'look')
  }

  input.hovered = actor
  hoverActor(actor ?? keyedActor.value)
  input.deps.wake()
}

// A person under the pointer is named with what they do now, for the tooltip and readers.
function actorTitleOf(input: PointerState, actor: ActorId): string {
  const sim = input.deps.readView()

  return hoverTextOf(personNameOf(sim, actor), actorNowOf(sim, actor), Date.now())
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
    case 'crew':
    case 'sign':
      return false
    default:
      return true
  }
}

function isSwitch(prop: PropDef): boolean {
  return prop.kind === 'lamp' || prop.kind === 'light-switch'
}

// A lamp or the wall switch says what a click does; the wet-floor sign says what it says.
function thingTitleOf(hit: Hit | undefined, prop: PropDef | undefined): string {
  return hit?.kind === 'sign' ? tr('ui.office.crew.wetFloor') : propTitleOf(prop)
}

function propTitleOf(prop: PropDef | undefined): string {
  if (prop?.kind === 'lamp') {
    return tr('ui.office.lights.lamp')
  }

  const clock = prop?.kind === 'clock' && prop.room === 'lobby' ? wallClockOf(prop) : undefined

  if (clock !== undefined) {
    return tr('ui.office.tip.clockAt', {
      place: clock.label,
      time: formatClock(pageNow(), clock.zone),
    })
  }

  return prop?.kind === 'light-switch' ? tr('ui.office.lights.switch') : ''
}

/** The person (or their tag) under a point. */
export function actorAt(input: PointerState, point: ScreenPoint): ActorId | undefined {
  const hit = pickAt(point, input.deps.renderer, input.deps.readView())
  const isPerson = hit?.kind === 'actor' || hit?.kind === 'tag'

  return isPerson && isActorId(hit.id) ? hit.id : undefined
}

function wallClockOf(prop: PropDef): WallClock | undefined {
  return regionPack.value.wallClocks[prop.variant ?? 0]
}

function toPetTip(id: string): TipSource | undefined {
  return PET_TIPS.find((tip) => tip === id)
}

function propOf(hit: Hit): PropDef | undefined {
  return propsOn(view.value.floor).find((prop) => prop.id === hit.id)
}
