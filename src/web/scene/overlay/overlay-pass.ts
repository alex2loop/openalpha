import { computed, effect, untracked } from '@preact/signals'

import type { Bubble } from '@/web/scene/overlay/bubbles'
import type { Marker } from '@/web/scene/overlay/markers'
import type { PlacedTag } from '@/web/scene/overlay/name-tags'
import type { LitScreen } from '@/web/scene/overlay/screens'
import type { SceneRenderer } from '@/web/scene/renderer'
import type { ActorId, Rect, RoomId, SimView, Size } from '@/web/scene/types'
import { pageMinute } from '@/web/scene/clock/clock'
import { requestSeries, screenSeries, startDeskReads } from '@/web/scene/data/desk-reads'
import { homeMarket } from '@/web/scene/data/home'
import { pastCalls, startPastCalls } from '@/web/scene/data/past-calls'
import { breachedStops } from '@/web/scene/data/room-status'
import { sceneGoals, wantedGoals } from '@/web/scene/overlay/actor-state'
import { bubbleSignatureOf, buildBubbles, said, startSpeech } from '@/web/scene/overlay/bubbles'
import { figureOf } from '@/web/scene/overlay/hit'
import { hoverPlaceOf } from '@/web/scene/overlay/hover-label'
import { buildMarkers, markerRectOf } from '@/web/scene/overlay/markers'
import { meetingBar, ringsOf } from '@/web/scene/overlay/meeting'
import { tagTextOf } from '@/web/scene/overlay/name-tags'
import {
  EMPTY_OVERLAY,
  hoverActor,
  hoveredActor,
  keyActor,
  keyedActor,
  type OverlayView,
  showOverlay,
} from '@/web/scene/overlay/overlay'
import {
  layoutOverlay,
  layoutTags,
  readOverlayFont,
  releaseMeasure,
  sizeBubble,
  sizeTag,
} from '@/web/scene/overlay/placement'
import { menuActor, menuPillRects, menuPlaceOf } from '@/web/scene/overlay/radial-menu'
import { analystSeriesOf, buildScreens } from '@/web/scene/overlay/screens'
import {
  addDeskOf,
  cardPlacesOf,
  childRoleIn,
  isTeamFloor,
  isTeamTagged,
} from '@/web/scene/overlay/team-pass'
import { isOnFloor } from '@/web/scene/sim/actors/poses'
import { isActorId, isCrewId, ownAgentIdOf } from '@/web/scene/sim/actors/roster'
import { projection, view } from '@/web/scene/view'
import { roomsOn } from '@/web/scene/world/rooms'
import { onWireEvent } from '@/web/state/events'
import { selectedActor } from '@/web/state/focus'
import { pending, runs } from '@/web/state/live'
import { tr } from '@/web/text/tr'

/** However still the inputs, the layout runs again this often while frames are drawn, and once
 *  more this long after its last change (the boards and room tags it avoids settle after it). */
const OVERLAY_REFRESH_MS = 250
// A speaker this far past the pane's edge, in CSS px, counts as off screen.
const OFF_SCREEN_PX = 16
// The boards, room tags and toolbar pieces other overlays draw; no bubble covers them.
const FIXED_SELECTOR =
  '.room-tag-row, .board-line, .scene-zoombtn, .scene-pan, .scene-hint, .meeting-bar'

/** Everything the layout reads from one frame. Figures are in CSS px of the scene host. */
interface PassInput {
  readonly view: SimView
  readonly bubbles: readonly Bubble[]
  readonly markers: readonly Marker[]
  readonly screens: readonly LitScreen[]
  readonly figures: ReadonlyMap<ActorId, Rect>
  readonly isZoomed: boolean
  readonly selected?: ActorId
  readonly hovered?: ActorId
  /** The people picked for a meeting, and the one the keyboard is on. */
  readonly picks: readonly ActorId[]
  readonly keyed?: ActorId
  /** The person whose radial menu is open. */
  readonly menu?: ActorId
}

interface PassState {
  signature: string
  laidAt: number
  isSettling: boolean
  expiresAt: number
}

/** The overlay's life on one mounted scene: it hears speech, reads past calls and desk data, and
 *  lays itself out from the frames the loop draws. */
export interface OverlayPass {
  /** Lays the overlay out after a drawn frame, only when an input changed or the refresh is due. */
  frame(sim: SimView, nowMs: number): void
  /** When a spoken line ends or a settling layout is due, as a `performance.now()` instant. */
  nextDueAt(): number
  stop(): void
}

interface PassDeps {
  readonly renderer: SceneRenderer
  /** The scene's root element, which every overlay is placed in. */
  readonly scene: HTMLElement
}

const litScreens = computed(() =>
  buildScreens({
    goals: wantedGoals.value,
    runs: runs.value,
    series: screenSeries.value,
    market: homeMarket.value?.market,
  })
)
/** The "!" over each person something waits on, wherever they stand. */
export const markers = computed(() =>
  buildMarkers({ goals: sceneGoals.value, pending: pending.value, breached: breachedStops.value })
)

/** Starts the overlay's listeners and reads; the returned pass's `stop` releases all of them. */
export function startOverlay(deps: PassDeps): OverlayPass {
  const state: PassState = {
    signature: '',
    laidAt: Number.NEGATIVE_INFINITY,
    isSettling: false,
    expiresAt: Number.POSITIVE_INFINITY,
  }
  const stops = [startSpeech(onWireEvent), startPastCalls(), startDeskReads(), effect(askSeries)]

  readOverlayFont(deps.scene)

  return {
    frame: (sim, nowMs) => runPass({ deps, state, sim, nowMs }),
    nextDueAt: () =>
      Math.min(state.expiresAt, state.isSettling ? state.laidAt + OVERLAY_REFRESH_MS : Infinity),
    stop: () => {
      for (const stop of stops) {
        stop()
      }

      showOverlay(EMPTY_OVERLAY)
      hoverActor(undefined)
      keyActor(undefined)
      releaseMeasure()
    },
  }
}

/** The signals the overlay reads besides the sim, for the scene to draw a frame when one moves. */
export function readOverlayInputs(): void {
  litScreens.value
  markers.value
  said.value
  pastCalls.value
  hoveredActor.value
  keyedActor.value
  menuActor.value
  meetingBar.value
}

// The analyst's ticker is read once per run and ticker, on the page's day.
function askSeries(): void {
  const ref = analystSeriesOf(
    { goals: wantedGoals.value, runs: runs.value, market: homeMarket.value?.market },
    pageMinute.value.day
  )

  if (ref !== undefined) {
    untracked(() => requestSeries(ref))
  }
}

interface PassRun {
  readonly deps: PassDeps
  readonly state: PassState
  readonly sim: SimView
  readonly nowMs: number
}

function runPass({ deps, state, sim, nowMs }: PassRun): void {
  const input = readPass(deps.renderer, sim, nowMs)
  const signature = signatureOf(input)

  state.expiresAt = Math.min(
    ...input.bubbles.map((bubble) => bubble.untilMs ?? Number.POSITIVE_INFINITY)
  )

  if (signature === state.signature && nowMs - state.laidAt < OVERLAY_REFRESH_MS) {
    return
  }

  state.isSettling = signature !== state.signature
  state.signature = signature
  state.laidAt = nowMs
  showOverlay(layOut(input, deps))
}

function readPass(renderer: SceneRenderer, sim: SimView, nowMs: number): PassInput {
  const goals = sceneGoals.value
  const shown = view.value
  const selected = toActorId(selectedActor.value)
  const hovered = hoveredActor.value
  const keyed = keyedActor.value
  const menu = menuActor.value
  const figures = new Map<ActorId, Rect>()

  for (const actor of sim.actors) {
    if (isOnFloor(actor, sim.floor)) {
      figures.set(actor.id, toScreenRect(renderer, figureOf(actor, sim.alpha)))
    }
  }

  return {
    view: sim,
    bubbles: buildBubbles({
      goals,
      runs: runs.value,
      pending: pending.value,
      said: said.value,
      recalls: pastCalls.value,
      life: sim.life.lines,
      teamLines: sim.team.lines,
      nowMs,
      epochMs: Date.now(),
    }),
    markers: markers.value,
    screens: litScreens.value.filter((screen) => screen.floor === sim.floor),
    figures,
    isZoomed: shown.room !== undefined || shown.zoomSteps > 0,
    ...(selected === undefined ? {} : { selected }),
    ...(hovered === undefined ? {} : { hovered }),
    picks: meetingBar.value.picks,
    ...(keyed === undefined ? {} : { keyed }),
    ...(menu === undefined ? {} : { menu }),
  }
}

// Everything a layout reads, as text: the camera, the pane, who is selected or hovered, each
// bubble's kind and text, markers, screens, and where the people it places things by stand.
function signatureOf(input: PassInput): string {
  const { pane, scale, originX, originY } = projection.value
  const placed = new Set<ActorId>([
    ...input.bubbles.map((bubble) => bubble.actor),
    ...input.markers.map((marker) => marker.actor),
    ...(input.selected === undefined ? [] : [input.selected]),
    ...(input.hovered === undefined ? [] : [input.hovered]),
    ...input.picks,
    ...(input.keyed === undefined ? [] : [input.keyed]),
    ...(input.menu === undefined ? [] : [input.menu]),
    ...[...input.figures.keys()].filter((actor) => ownAgentIdOf(actor) !== undefined),
  ])
  const people = [...input.figures]
    .filter(([actor]) => input.isZoomed || placed.has(actor))
    .map(([actor, rect]) => `${actor}:${Math.round(rect.x)},${Math.round(rect.y)}`)

  return [
    input.view.floor,
    `${scale},${originX},${originY},${pane.w},${pane.h}`,
    `${input.isZoomed}`,
    input.selected ?? '',
    input.hovered ?? '',
    hoverPlaceOf(input.view, { actor: input.hovered, figures: input.figures })?.text ?? '',
    input.picks.join(','),
    input.keyed ?? '',
    input.menu ?? '',
    ...input.bubbles.map(bubbleSignatureOf),
    ...input.markers.map((marker) => `${marker.actor}:${marker.tone}`),
    ...input.screens.map((screen) => `${screen.actor}:${JSON.stringify(screen.content)}`),
    ...input.view.team.desks.map(
      (desk) => `${desk.slot}:${desk.agentId ?? ''}:${desk.childrenOpen}:${desk.childrenBack}`
    ),
    ...people,
  ].join('|')
}

function layOut(input: PassInput, deps: PassDeps): OverlayView {
  const { scale } = projection.value
  const markerPlaces = input.markers.flatMap((marker) => {
    const figure = input.figures.get(marker.actor)

    return figure === undefined ? [] : [{ marker, rect: markerRectOf(figure, scale) }]
  })
  const screenPlaces = input.screens.map((screen) => ({
    screen,
    rect: toScreenRect(deps.renderer, screen.rect),
  }))
  const team = teamPlacesOf(input, deps.renderer)
  const fixed = [
    ...readFixed(deps.scene),
    ...markerPlaces.map((place) => place.rect),
    ...screenPlaces.map((place) => place.rect),
    ...team.cards.map((place) => place.rect),
    ...(team.addDesk === undefined ? [] : [team.addDesk]),
    ...menuPillRects(input.figures, input.menu),
  ]
  const tags = layoutTags(tagAsks(input), { actors: input.figures, taken: fixed })
  const hover = hoverPlaceOf(input.view, { actor: input.hovered, figures: input.figures })
  const layout = layoutOverlay({
    bubbles: shownBubbles(input).map((bubble) => sizeBubble(bubble, actionsOf(bubble))),
    fixed,
    tags: [...tags.values()],
    ...(hover === undefined ? {} : { hover: hover.label }),
    rooms: roomRects(input.view, deps.renderer),
    actors: input.figures,
  })
  const taken = [...fixed, ...tags.values(), ...layout.placed.map((placed) => placed.rect)]

  return {
    bubbles: layout.placed,
    tags: withMore(input, { tags, hidden: layout.hidden, taken }),
    markers: markerPlaces,
    screens: screenPlaces,
    ...team,
    ...(hover === undefined || layout.hover === undefined
      ? {}
      : { hover: { actor: hover.actor, name: hover.name, rect: layout.hover, now: hover.now } }),
    ...marksOf(input),
  }
}

// The rings under the picked and the keyboard-focused, and where the open radial menu stands.
function marksOf(input: PassInput): Pick<OverlayView, 'rings' | 'menu'> {
  const keyed = input.keyed === undefined ? {} : { keyed: input.keyed }

  return {
    rings: ringsOf(input.figures, { picks: input.picks, ...keyed }),
    ...menuPlaceOf(input.figures, input.menu),
  }
}

// The team floor's cards over its agents' heads, and "+ Thêm agent" on its next free desk.
function teamPlacesOf(
  input: PassInput,
  renderer: SceneRenderer
): Pick<OverlayView, 'cards' | 'addDesk'> {
  const { scale, baseScale } = projection.value
  const zoom = baseScale > 0 ? scale / baseScale : 1
  const cards = cardPlacesOf(input.view, { figures: input.figures, zoom })
  const addDesk = addDeskOf(input.view)

  return addDesk === undefined ? { cards } : { cards, addDesk: toScreenRect(renderer, addDesk) }
}

// At floor zoom only waits show, unless the speaker is selected or on the team floor; none off screen.
function shownBubbles(input: PassInput): Bubble[] {
  const { pane } = projection.value

  return input.bubbles.filter((bubble) => {
    const figure = input.figures.get(bubble.actor)
    const isWanted =
      bubble.kind === 'wait' ||
      input.isZoomed ||
      isTeamFloor(input.view) ||
      bubble.actor === input.selected

    return isWanted && figure !== undefined && isOnScreen(figure, pane)
  })
}

function actionsOf(bubble: Bubble): string[] {
  return [
    ...(bubble.kind === 'wait' ? [tr('ui.office.bubble.open')] : []),
    ...(bubble.full === bubble.text ? [] : [tr('ui.office.bubble.more')]),
  ]
}

// Zoomed in the staff have tags, at floor zoom the selected and team children; own agents wear a
// card, the crew show their role on hover, and a hovered person's one label is the hover card.
function tagAsks(input: PassInput): { actor: ActorId; size: Size; isForced: boolean }[] {
  return [...input.figures.keys()]
    .filter(
      (actor) => actor !== input.hovered && ownAgentIdOf(actor) === undefined && !isCrewId(actor)
    )
    .filter(
      (actor) => input.isZoomed || actor === input.selected || isTeamTagged(input.view, actor)
    )
    .map((actor) => ({
      actor,
      size: sizeTag(textOf(input, actor, false)),
      isForced: actor === input.selected,
    }))
}

function textOf(input: PassInput, actor: ActorId, isMore: boolean): string {
  return tagTextOf(actor, isMore, childRoleIn(input.view, actor))
}

interface TagSet {
  readonly tags: ReadonlyMap<ActorId, Rect>
  readonly hidden: readonly ActorId[]
  readonly taken: readonly Rect[]
}

// A person whose bubble found no room gets "..." on its tag; with no tag yet, one is placed for it.
function withMore(input: PassInput, set: TagSet): PlacedTag[] {
  const hidden = new Set(set.hidden)
  const extra = layoutTags(
    set.hidden
      .filter((actor) => !set.tags.has(actor))
      .map((actor) => ({ actor, size: sizeTag(textOf(input, actor, true)), isForced: false })),
    { actors: input.figures, taken: set.taken }
  )

  return [...set.tags, ...extra].map(([actor, rect]) => ({
    actor,
    text: textOf(input, actor, hidden.has(actor)),
    rect:
      hidden.has(actor) && set.tags.has(actor)
        ? { ...rect, ...sizeTag(textOf(input, actor, true)) }
        : rect,
    isSelected: actor === input.selected,
    isMore: hidden.has(actor),
  }))
}

function roomRects(sim: SimView, renderer: SceneRenderer): ReadonlyMap<RoomId, Rect> {
  return new Map(roomsOn(sim.floor).map((room) => [room.id, toScreenRect(renderer, room.rect)]))
}

// The boxes other overlays drew, read only when a layout runs, never per frame.
function readFixed(scene: HTMLElement): Rect[] {
  const origin = scene.getBoundingClientRect()

  return [...scene.querySelectorAll(FIXED_SELECTOR)].map((element) => {
    const box = element.getBoundingClientRect()

    return { x: box.left - origin.left, y: box.top - origin.top, w: box.width, h: box.height }
  })
}

function toScreenRect(renderer: SceneRenderer, rect: Rect): Rect {
  const from = renderer.toScreen({ x: rect.x, y: rect.y })
  const to = renderer.toScreen({ x: rect.x + rect.w, y: rect.y + rect.h })

  return { x: from.x, y: from.y, w: to.x - from.x, h: to.y - from.y }
}

function isOnScreen(rect: Rect, pane: Size): boolean {
  const x = rect.x + rect.w / 2

  return (
    x >= -OFF_SCREEN_PX &&
    x <= pane.w + OFF_SCREEN_PX &&
    rect.y + rect.h >= -OFF_SCREEN_PX &&
    rect.y <= pane.h + OFF_SCREEN_PX
  )
}

function toActorId(id: string | undefined): ActorId | undefined {
  return id !== undefined && isActorId(id) ? id : undefined
}
