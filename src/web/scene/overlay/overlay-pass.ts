import { effect, untracked } from '@preact/signals'

import type { Bubble } from '@/web/scene/overlay/bubbles'
import type { Marker } from '@/web/scene/overlay/markers'
import type { PlacedTag } from '@/web/scene/overlay/name-tags'
import type { LitScreen } from '@/web/scene/overlay/screens'
import type { SceneRenderer } from '@/web/scene/renderer'
import type { ActorId, Rect, SimView, Size } from '@/web/scene/types'
import { ambientMsOf } from '@/web/scene/budgets'
import { pageMinute } from '@/web/scene/clock/clock'
import { requestSeries, startDeskReads } from '@/web/scene/data/desk-reads'
import { homeMarket } from '@/web/scene/data/home'
import { pastCalls, startPastCalls } from '@/web/scene/data/past-calls'
import { ringsOf } from '@/web/scene/overlay/actor-focus'
import { sceneGoals, wantedGoals } from '@/web/scene/overlay/actor-state'
import { bubbleSignatureOf, buildBubbles, said, startSpeech } from '@/web/scene/overlay/bubbles'
import { sceneHandOff } from '@/web/scene/overlay/hand-off'
import { figureOf } from '@/web/scene/overlay/hit'
import { hoverPlaceOf } from '@/web/scene/overlay/hover-label'
import { withLiveScreens } from '@/web/scene/overlay/live-screens'
import { placeMarkers } from '@/web/scene/overlay/markers'
import { menuClearOf, showMenuLabels, syncMenuLabels } from '@/web/scene/overlay/menu-clear'
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
  isTaken,
  layoutOverlay,
  layoutTags,
  readOverlayFont,
  releaseMeasure,
  sizeBubble,
  sizeTag,
} from '@/web/scene/overlay/placement'
import { menuActor, menuPillRects, menuPlaceOf, menuRingOf } from '@/web/scene/overlay/radial-menu'
import { isOnScreen, readFixed, roomRects, toScreenRect } from '@/web/scene/overlay/screen-rects'
import { createScreenTyping, type ScreenTyping } from '@/web/scene/overlay/screen-typing'
import { analystSeriesOf, buildTeamScreens } from '@/web/scene/overlay/screens'
import {
  addDeskOf,
  cardPlacesOf,
  childRoleIn,
  isTeamFloor,
  isTeamTagged,
} from '@/web/scene/overlay/team-pass'
import { syncTwin } from '@/web/scene/overlay/twin'
import { isOnFloor } from '@/web/scene/sim/actors/poses'
import { isActorId, isCrewId, ownAgentIdOf } from '@/web/scene/sim/actors/roster'
import { projection, view } from '@/web/scene/view'
import { onWireEvent } from '@/web/state/events'
import { selectedActor } from '@/web/state/focus'
import { pending, runs } from '@/web/state/live'
import { reducedMotion } from '@/web/state/prefs'
import { tr } from '@/web/text/tr'

/** However still the inputs, the layout runs again this often while frames are drawn, and once
 *  more this long after its last change (the boards and room tags it avoids settle after it). */
const OVERLAY_REFRESH_MS = 250

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
  /** The one the keyboard is on. */
  readonly keyed?: ActorId
  /** The person whose radial menu is open. */
  readonly menu?: ActorId
}

interface PassState {
  readonly typing: ScreenTyping
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

/** Starts the overlay's listeners and reads; the returned pass's `stop` releases all of them. */
export function startOverlay(deps: PassDeps): OverlayPass {
  const state: PassState = {
    typing: createScreenTyping(),
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
      Math.min(
        state.expiresAt,
        state.typing.nextDueAt(),
        state.isSettling ? state.laidAt + OVERLAY_REFRESH_MS : Infinity
      ),
    stop: () => {
      for (const stop of stops) {
        stop()
      }

      state.typing.clear()
      showOverlay(EMPTY_OVERLAY)
      syncTwin(undefined, [])
      hoverActor(undefined)
      keyActor(undefined)
      showMenuLabels(deps.scene.ownerDocument)
      releaseMeasure()
    },
  }
}

/** The signals the overlay reads besides the sim, for the scene to draw a frame when one moves. */
export function readOverlayInputs(): void {
  sceneHandOff.value
  said.value
  pastCalls.value
  hoveredActor.value
  keyedActor.value
  menuActor.value
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

  state.typing.step(input.screens, { beatMs: ambientMsOf(nowMs), isReduced: reducedMotion.value })

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
    markers: sceneHandOff.value.marks,
    screens: [
      ...withLiveScreens(sceneHandOff.value, sim.life.deskItems).deskScreens.filter(
        (screen) => screen.floor === sim.floor
      ),
      ...buildTeamScreens({ floor: sim.floor, actors: sim.actors, runs: runs.value }),
    ],
    figures,
    isZoomed: shown.room !== undefined || shown.zoomSteps > 0,
    ...(selected === undefined ? {} : { selected }),
    ...(hovered === undefined ? {} : { hovered }),
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

// While a radial menu is open its person wears no tag or hover label (the menu names them), and a
// label or marker the pills or the reply would meet is hidden.
function layOut(input: PassInput, deps: PassDeps): OverlayView {
  const { markerPlaces, screenPlaces } = placesOf(input, deps.renderer)
  const team = teamPlacesOf(input, deps.renderer)
  const chrome = readFixed(deps.scene)
  const pills = menuPillRects(input.figures, input.menu)
  const fixed = [
    ...[...chrome, ...markerPlaces, ...screenPlaces].map((place) => place.rect),
    ...team.cards.map((place) => place.rect),
    ...(team.addDesk === undefined ? [] : [team.addDesk]),
    ...pills,
  ]
  const tags = layoutTags(tagAsks(input), { actors: input.figures, taken: fixed })
  const hovered = input.hovered === input.menu ? undefined : input.hovered
  const hover = hoverPlaceOf(input.view, { actor: hovered, figures: input.figures })
  const layout = layoutOverlay({
    bubbles: shownBubbles(input).map((bubble) => sizeBubble(bubble, actionsOf(bubble))),
    fixed,
    tags: [...tags.values()],
    ...(hover === undefined ? {} : { hover: hover.label }),
    rooms: roomRects(input.view, deps.renderer),
    actors: input.figures,
    selected: input.selected,
    ...menuRingOf(input.figures, input.menu),
  })
  const taken = [...fixed, ...tags.values(), ...layout.placed.map((placed) => placed.rect)]
  const clear = menuClearOf(pills, { actor: input.menu, placed: layout.placed })

  syncMenuLabels(chrome, clear)

  return {
    bubbles: layout.placed,
    tags: withMore(input, { tags, hidden: layout.hidden, taken }),
    markers: markerPlaces.filter((place) => !isTaken(place.rect, clear)),
    screens: screenPlaces,
    ...team,
    ...(hover === undefined || layout.hover === undefined
      ? {}
      : { hover: { actor: hover.actor, name: hover.name, rect: layout.hover, now: hover.now } }),
    ...marksOf(input),
  }
}

// The hand-off markers over heads and the lit screens, in CSS px of the scene host.
function placesOf(
  input: PassInput,
  renderer: SceneRenderer
): { markerPlaces: OverlayView['markers']; screenPlaces: OverlayView['screens'] } {
  return {
    markerPlaces: placeMarkers(input.markers, {
      figures: input.figures,
      scale: projection.value.scale,
    }),
    screenPlaces: input.screens.map((screen) => ({
      screen,
      rect: toScreenRect(renderer, screen.rect),
    })),
  }
}

// The rings under the selected and the keyboard-focused, and where the open radial menu stands.
function marksOf(input: PassInput): Pick<OverlayView, 'rings' | 'menu'> {
  return {
    rings: ringsOf(input.figures, input.keyed),
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
      (actor) =>
        actor !== input.hovered &&
        actor !== input.menu &&
        ownAgentIdOf(actor) === undefined &&
        !isCrewId(actor)
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

function toActorId(id: string | undefined): ActorId | undefined {
  return id !== undefined && isActorId(id) ? id : undefined
}
