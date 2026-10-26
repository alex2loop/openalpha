import { computed, effect, untracked } from '@preact/signals'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'

import type { RoomId, SimView } from '@/web/scene/types'
import { clockMode, pageMinute, setSceneZone } from '@/web/scene/clock/clock'
import { agenda, startAgenda } from '@/web/scene/data/agenda'
import { heldNewsPins, indexDrop, startBoard, todayCalls } from '@/web/scene/data/board'
import { homeMarket, startHome } from '@/web/scene/data/home'
import { roomOfRun, roomStatus, startRoomStatus } from '@/web/scene/data/room-status'
import { coolerOffer, startTeamCalls } from '@/web/scene/data/team-calls'
import { AddDesk } from '@/web/scene/overlay/add-desk'
import { AgentCards } from '@/web/scene/overlay/agent-card'
import { BoardButtons } from '@/web/scene/overlay/board-buttons'
import { EmptyTeam } from '@/web/scene/overlay/empty-team'
import { MeetingBar } from '@/web/scene/overlay/meeting-bar'
import { ObjectTip } from '@/web/scene/overlay/object-tip'
import { SceneOverlay } from '@/web/scene/overlay/overlay'
import {
  markers,
  type OverlayPass,
  readOverlayInputs,
  startOverlay,
} from '@/web/scene/overlay/overlay-pass'
import { PerfReadout } from '@/web/scene/overlay/perf-readout'
import { RadialMenu } from '@/web/scene/overlay/radial-menu'
import { RoomTags } from '@/web/scene/overlay/room-tags'
import {
  type InputSlot,
  type Renderers,
  SCENE_KEYS_ID,
  SCENE_LABEL_ID,
  startViews,
} from '@/web/scene/overlay/scene-views'
import { Toolbar } from '@/web/scene/overlay/toolbar'
import { syncTwin } from '@/web/scene/overlay/twin'
import { ViewNote } from '@/web/scene/overlay/view-note'
import { createRenderer2d } from '@/web/scene/render2d/renderer-2d'
import { createRendererHost, type SceneRenderer } from '@/web/scene/renderer'
import { nextAmbientAt } from '@/web/scene/sim/actors/poses'
import { isChildActorId } from '@/web/scene/sim/actors/roster'
import { type ActorState, createDirector, type Director } from '@/web/scene/sim/director'
import { createLife, type Life, lampGlowOf } from '@/web/scene/sim/life/life'
import { createSimLoop } from '@/web/scene/sim/loop'
import { homePhase, isClosedPhase } from '@/web/scene/sim/rhythm'
import { createTeam, type Team } from '@/web/scene/sim/team/team'
import { bringIntoView, canFollow, readLastInteractionAt, view, zoomToRoom } from '@/web/scene/view'
import { ROOMS, roomById } from '@/web/scene/world/rooms'
import { agents } from '@/web/state/agents'
import { breakpoint } from '@/web/state/breakpoints'
import { onWireEvent } from '@/web/state/events'
import { focusRequest, selectActor, selectedActor } from '@/web/state/focus'
import { findRun, pending, runs } from '@/web/state/live'
import { unread } from '@/web/state/notices'
import { colorScheme, colourPair, lampsOff, lightByHour, reducedMotion } from '@/web/state/prefs'
import { state } from '@/web/state/session'
import { MINUTES_PER_HOUR } from '@/web/text/time-units'
import { tr } from '@/web/text/tr'

import './canvas.css'

// The tray counts unread notices; before the first read there are none to count.
const unreadCount = computed(() => unread.value ?? 0)
/** The office scene: the mounted renderer driven by the sim loop, sized to its pane, with its
 *  overlays on top. */
export function SceneCanvas() {
  const host = useRef<HTMLDivElement>(null)
  const [renderers] = useState(createRenderers)
  const renderer = renderers.host

  useLayoutEffect(() => {
    const element = host.current

    return element === null ? undefined : mountScene(element, renderers)
  }, [renderers])

  useEffect(() => effect(syncSceneZone), [])

  return (
    <div class="scene">
      <p id={SCENE_LABEL_ID} class="sr">
        {tr('ui.office.a11y.scene')}
      </p>
      <p id={SCENE_KEYS_ID} class="sr">
        {tr('ui.office.a11y.canvasKeys')}
      </p>
      <div ref={host} class="scene-host" />
      <RoomTags renderer={renderer} />
      <BoardButtons renderer={renderer} />
      <SceneOverlay />
      <AgentCards />
      <AddDesk />
      <EmptyTeam />
      <ObjectTip />
      <MeetingBar />
      <RadialMenu />
      <Toolbar />
      <PerfReadout renderer={renderer} />
      <ViewNote />
    </div>
  )
}

function createRenderers(): Renderers {
  const flat = createRenderer2d()

  return { flat, host: createRendererHost(flat) }
}

// Everything it arms, the returned stop releases: data reads, the director, the overlay, loop,
// input, observer, listeners and the renderer.
function mountScene(element: HTMLElement, renderers: Renderers): () => void {
  const renderer = renderers.host
  const stops = [startHome(), startBoard(), startRoomStatus(), startAgenda(), startTeamCalls()]
  const { director, life, team } = createCrew()

  renderer.mount(element)

  const overlay = startOverlay({ renderer, scene: element.parentElement ?? element })
  const input: InputSlot = { current: undefined }
  const { loop, readView } = createSceneLoop({ director, life, team, renderer, overlay, input })
  const offs = [
    startViews({
      renderers,
      element,
      input,
      pointer: { renderer, readView, director, wake: loop.wake },
      load3d: loadRenderer3d,
    }),
    watchPane(element, loop),
    effect(() => {
      readSceneInputs()
      untracked(loop.wake)
    }),
    effect(() => answerFocusRequest(director)),
    onWireEvent('any', loop.wake),
    onWireEvent('run_started', (event) => followRun(director, event.runId)),
  ]

  loop.start()

  return () => {
    for (const off of offs) {
      off()
    }

    loop.stop()
    overlay.stop()
    life.dispose()
    director.dispose()
    team.dispose()
    selectActor(undefined)
    renderer.unmount()

    for (const stop of stops) {
      stop()
    }
  }
}

// The office's people, the office life over them and the team floor; the caller disposes each.
function createCrew(): Pick<LoopParts, 'director' | 'life' | 'team'> {
  const director = createDirector({ runs, pending, unread: unreadCount, hub: onWireEvent })
  const team = createTeam({ agents, runs, offers: coolerOffer, hub: onWireEvent })
  const teamDesks = () => team.view(performance.now()).desks

  return { director, life: createLife({ director, teamDesks, reduced: reducedMotion }), team }
}

interface LoopParts {
  readonly director: Director
  readonly life: Life
  readonly team: Team
  readonly renderer: SceneRenderer
  readonly overlay: OverlayPass
  readonly input: InputSlot
}

// The sim loop over the director; each drawn frame lays the overlay out after it, and the
// snapshot it drew is what the hit test reads.
function createSceneLoop(parts: LoopParts): {
  readonly loop: ReturnType<typeof createSimLoop>
  readonly readView: () => SimView
} {
  const { director, life, team, renderer, overlay, input } = parts
  let drawn = buildSimView(parts, 0)
  const loop = createSimLoop({
    step: (index) => {
      const nowMs = performance.now()
      // Life first, so a goal it sets walks in this step rather than waiting for the next wake.
      const isLiving = life.step(index)
      const isDirected = director.step(index)
      const isTeamed = team.step(nowMs)

      return (input.current?.step(nowMs) ?? false) || isTeamed || isLiving || isDirected
    },
    draw: (alpha, now) => {
      drawn = buildSimView(parts, alpha)
      dropGoneSelection(drawn)
      input.current?.frame(drawn)

      const isAnimating = renderer.draw(drawn, now)

      overlay.frame(drawn, now)
      syncTwin(drawn, markers.value)

      return isAnimating
    },
    resume: () => {
      director.resume()
      life.resume()
      team.resume()
    },
    nextDueAt: () => {
      const floor = view.value.floor
      const nowMs = performance.now()
      const hasPeople = drawn.actors.some((actor) => actor.floor === floor)
      const ambientAt = hasPeople ? nextAmbientAt(floor, nowMs) : Infinity

      return Math.min(
        director.nextDueAt(),
        life.nextDueAt(),
        team.nextDueAt(nowMs),
        overlay.nextDueAt(),
        input.current?.nextDueAt() ?? Infinity,
        ambientAt
      )
    },
  })

  return { loop, readView: () => drawn }
}

function buildSimView(
  parts: Pick<LoopParts, 'director' | 'life' | 'team'>,
  alpha: number
): SimView {
  const off = lampsOff.value
  const lit = new Set<RoomId>(ROOMS.filter((room) => !off.has(room.id)).map((room) => room.id))
  const office = parts.director.view()
  const statuses = parts.life.statuses(office.actors)
  const actors = office.actors.map((actor) => {
    const status = statuses.get(actor.id)

    return status === undefined ? actor : { ...actor, status }
  })

  return {
    floor: view.value.floor,
    alpha,
    ...office,
    actors: [...actors, ...parts.team.actors()],
    props: { lit, lampGlow: lampGlowOf(), isClosed: isClosedPhase(homePhase.value) },
    light: { hour: pageMinute.value.minute / MINUTES_PER_HOUR, followsHour: lightByHour.value },
    life: parts.life.view(),
    team: parts.team.view(performance.now()),
  }
}

// A child who left the floor is no longer anyone to look at.
function dropGoneSelection(sim: SimView): void {
  const selected = selectedActor.peek()

  if (selected !== undefined && isChildActorId(selected) && !isPresent(sim, selected)) {
    selectActor(undefined)
  }
}

function isPresent(sim: SimView, actor: string): boolean {
  return sim.actors.some((held) => held.id === actor)
}

// What the picture shows besides the sim, and what retargets it (the live store, the clock's
// mode, reduced motion): a change to any of these draws a frame and steps the sim.
function readSceneInputs(): void {
  runs.value
  pending.value
  clockMode.value
  reducedMotion.value
  selectedActor.value
  view.value
  lampsOff.value
  lightByHour.value
  pageMinute.value
  colorScheme.value
  colourPair.value
  breakpoint.value
  agenda.value
  roomStatus.value
  todayCalls.value
  heldNewsPins.value
  indexDrop.value
  unread.value
  homePhase.value
  agents.value
  coolerOffer.value
  readOverlayInputs()
}

async function loadRenderer3d(): Promise<() => SceneRenderer> {
  return (await import('./render3d/renderer-3d')).createRenderer3d
}

// A resize or a move to a screen of another density draws again; the returned stop releases both.
// A pane hidden by `display: none` measures zero: the loop rests until it has a size again.
function watchPane(
  element: HTMLElement,
  loop: Pick<ReturnType<typeof createSimLoop>, 'wake' | 'show'>
): () => void {
  const resize = new ResizeObserver(() => {
    loop.show(element.clientWidth > 0 && element.clientHeight > 0)
    loop.wake()
  })
  const listeners = new AbortController()

  resize.observe(element)
  watchResolution(loop.wake, listeners.signal)

  return () => {
    resize.disconnect()
    listeners.abort()
  }
}

// A move to a screen of another pixel density redraws at the new density; the query is re-armed for
// the density it lands on.
function watchResolution(onChange: () => void, signal: AbortSignal): void {
  if (signal.aborted) {
    return
  }

  const query = matchMedia(`(resolution: ${devicePixelRatio}dppx)`)

  query.addEventListener(
    'change',
    () => {
      onChange()
      watchResolution(onChange, signal)
    },
    { signal, once: true }
  )
}

// The home market's session zone, else the operator's `[locale] timezone`.
function syncSceneZone(): void {
  const timeZone = homeMarket.value?.session?.timeZone ?? state.value?.timeZone

  if (timeZone !== undefined) {
    untracked(() => setSceneZone(timeZone))
  }
}

// "Xem" on a run: its actor is selected and its room comes into view, on its floor (zoomed into on
// a narrow screen, where the office pane was just brought forward); a run with no room moves nothing.
function answerFocusRequest(director: Director): void {
  const request = focusRequest.value

  if (request === undefined) {
    return
  }

  untracked(() => {
    const actor = actorOfRun(director, request.runId)
    const run = findRun(request.runId)
    const roomId = actor?.def.room ?? (run === undefined ? undefined : roomOfRun(run))

    selectActor(actor?.def.id)
    showRoom(roomId, { isClose: breakpoint.value !== 'wide' })
  })
}

// A new run the office can place: the camera goes to its room, unless the operator moved the
// camera in the last few seconds or it follows someone.
function followRun(director: Director, runId: string | undefined): void {
  const actor = runId === undefined ? undefined : actorOfRun(director, runId)
  const isFree =
    view.value.follow === undefined && canFollow(readLastInteractionAt(), performance.now())

  if (actor !== undefined && isFree) {
    showRoom(actor.def.room)
  }
}

function actorOfRun(director: Director, runId: string): ActorState | undefined {
  return [...director.actors().values()].find((actor) => actor.goal?.runId === runId)
}

function showRoom(roomId: RoomId | undefined, opts: { readonly isClose?: boolean } = {}): void {
  const room = roomId === undefined ? undefined : roomById(roomId)

  if (room === undefined) {
    return
  }

  if (opts.isClose === true) {
    zoomToRoom(room.id, room.rect, room.floor)
    return
  }

  bringIntoView({ floor: room.floor, rect: room.rect, room: { id: room.id, rect: room.rect } })
}
