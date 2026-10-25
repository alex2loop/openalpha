import { computed, effect, untracked } from '@preact/signals'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { SceneRenderer } from '@/web/scene/renderer'
import type { RoomId, SimView } from '@/web/scene/types'
import { clockMode, pageMinute, setSceneZone } from '@/web/scene/clock/clock'
import { agenda, startAgenda } from '@/web/scene/data/agenda'
import { heldNewsPins, indexDrop, startBoard, todayCalls } from '@/web/scene/data/board'
import { homeMarket, startHome } from '@/web/scene/data/home'
import { roomOfRun, roomStatus, startRoomStatus } from '@/web/scene/data/room-status'
import { BoardButtons } from '@/web/scene/overlay/board-buttons'
import { attachInteraction } from '@/web/scene/overlay/interact'
import { ObjectTip } from '@/web/scene/overlay/object-tip'
import { SceneOverlay } from '@/web/scene/overlay/overlay'
import { type OverlayPass, readOverlayInputs, startOverlay } from '@/web/scene/overlay/overlay-pass'
import { PerfReadout } from '@/web/scene/overlay/perf-readout'
import { RoomTags } from '@/web/scene/overlay/room-tags'
import { Toolbar } from '@/web/scene/overlay/toolbar'
import { createRenderer2d } from '@/web/scene/render2d/renderer-2d'
import { type ActorState, createDirector, type Director } from '@/web/scene/sim/director'
import { createSimLoop } from '@/web/scene/sim/loop'
import { bringIntoView, canFollow, readLastInteractionAt, view } from '@/web/scene/view'
import { ROOMS, roomById } from '@/web/scene/world/rooms'
import { breakpoint } from '@/web/state/breakpoints'
import { onWireEvent } from '@/web/state/events'
import { focusRequest, selectActor, selectedActor } from '@/web/state/focus'
import { findRun, pending, runs } from '@/web/state/live'
import { unread } from '@/web/state/notices'
import { colorScheme, lampsOff, lightByHour, reducedMotion } from '@/web/state/prefs'
import { state } from '@/web/state/session'
import { MINUTES_PER_HOUR } from '@/web/text/time'

import './canvas.css'

// The tray counts unread notices; before the first read there are none to count.
const unreadCount = computed(() => unread.value ?? 0)

/** The office scene: the mounted renderer driven by the sim loop, sized to its pane, with its
 *  overlays on top. */
export function SceneCanvas() {
  const host = useRef<HTMLDivElement>(null)
  const [renderer] = useState(createRenderer2d)

  useEffect(() => {
    const element = host.current

    return element === null ? undefined : mountScene(element, renderer)
  }, [renderer])

  useEffect(() => effect(syncSceneZone), [])

  return (
    <div class="scene">
      <div ref={host} class="scene-host" />
      <RoomTags renderer={renderer} />
      <BoardButtons renderer={renderer} />
      <SceneOverlay />
      <ObjectTip />
      <Toolbar />
      <PerfReadout renderer={renderer} />
    </div>
  )
}

// Everything it arms, the returned stop releases: data reads, the director, the overlay, loop,
// input, observer, listeners and the renderer.
function mountScene(element: HTMLElement, renderer: SceneRenderer): () => void {
  const listeners = new AbortController()
  const stops = [startHome(), startBoard(), startRoomStatus(), startAgenda()]
  const director = createDirector({ runs, pending, unread: unreadCount, hub: onWireEvent })

  renderer.mount(element)

  const overlay = startOverlay({ renderer, scene: element.parentElement ?? element })
  const { loop, readView } = createSceneLoop({ director, renderer, overlay })
  const resize = new ResizeObserver(() => loop.wake())
  const canvas = element.querySelector('canvas')
  const detach =
    canvas === null ? () => undefined : attachInteraction(canvas, { renderer, readView })
  const offs = [
    effect(() => {
      readSceneInputs()
      untracked(loop.wake)
    }),
    effect(() => answerFocusRequest(director)),
    onWireEvent('any', loop.wake),
    onWireEvent('run_started', (event) => followRun(director, event.runId)),
  ]

  resize.observe(element)
  watchResolution(loop.wake, listeners.signal)
  loop.start()

  return () => {
    for (const off of offs) {
      off()
    }

    detach()
    loop.stop()
    overlay.stop()
    director.dispose()
    selectActor(undefined)
    resize.disconnect()
    listeners.abort()
    renderer.unmount()

    for (const stop of stops) {
      stop()
    }
  }
}

interface LoopParts {
  readonly director: Director
  readonly renderer: SceneRenderer
  readonly overlay: OverlayPass
}

// The sim loop over the director; each drawn frame lays the overlay out after it, and the
// snapshot it drew is what the hit test reads.
function createSceneLoop(parts: LoopParts): {
  readonly loop: ReturnType<typeof createSimLoop>
  readonly readView: () => SimView
} {
  const { director, renderer, overlay } = parts
  let drawn = buildSimView(director, 0)
  const loop = createSimLoop({
    step: (index) => director.step(index),
    draw: (alpha, now) => {
      drawn = buildSimView(director, alpha)

      const isAnimating = renderer.draw(drawn, now)

      overlay.frame(drawn, now)

      return isAnimating
    },
    resume: () => director.resume(),
    nextDueAt: () => Math.min(director.nextDueAt(), overlay.nextDueAt()),
  })

  return { loop, readView: () => drawn }
}

function buildSimView(director: Director, alpha: number): SimView {
  const off = lampsOff.value
  const lit = new Set<RoomId>(ROOMS.filter((room) => !off.has(room.id)).map((room) => room.id))

  return {
    floor: view.value.floor,
    alpha,
    ...director.view(),
    props: { lit },
    light: { hour: pageMinute.value.minute / MINUTES_PER_HOUR, followsHour: lightByHour.value },
  }
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
  breakpoint.value
  agenda.value
  roomStatus.value
  todayCalls.value
  heldNewsPins.value
  indexDrop.value
  unread.value
  readOverlayInputs()
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

// "Xem" on a run: its actor is selected and its room comes into view, on its floor; a run with no
// room moves nothing.
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
    showRoom(roomId)
  })
}

// A new run the office can place: the camera goes to its room, unless the operator moved the
// camera in the last few seconds.
function followRun(director: Director, runId: string | undefined): void {
  const actor = runId === undefined ? undefined : actorOfRun(director, runId)

  if (actor !== undefined && canFollow(readLastInteractionAt(), performance.now())) {
    showRoom(actor.def.room)
  }
}

function actorOfRun(director: Director, runId: string): ActorState | undefined {
  return [...director.actors().values()].find((actor) => actor.goal?.runId === runId)
}

function showRoom(roomId: RoomId | undefined): void {
  const room = roomId === undefined ? undefined : roomById(roomId)

  if (room !== undefined) {
    bringIntoView({ floor: room.floor, rect: room.rect, room: { id: room.id, rect: room.rect } })
  }
}
