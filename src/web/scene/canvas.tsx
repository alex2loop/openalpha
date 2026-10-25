import { effect, untracked } from '@preact/signals'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { SceneRenderer } from '@/web/scene/renderer'
import type { RoomId, SimView } from '@/web/scene/types'
import { pageMinute, setSceneZone } from '@/web/scene/clock/clock'
import { agenda, startAgenda } from '@/web/scene/data/agenda'
import { heldNewsPins, indexDrop, startBoard, todayCalls } from '@/web/scene/data/board'
import { homeMarket, startHome } from '@/web/scene/data/home'
import { roomOfRun, roomStatus, startRoomStatus } from '@/web/scene/data/room-status'
import { BoardButtons } from '@/web/scene/overlay/board-buttons'
import { attachInteraction } from '@/web/scene/overlay/interact'
import { ObjectTip } from '@/web/scene/overlay/object-tip'
import { PerfReadout } from '@/web/scene/overlay/perf-readout'
import { RoomTags } from '@/web/scene/overlay/room-tags'
import { Toolbar } from '@/web/scene/overlay/toolbar'
import { createRenderer2d } from '@/web/scene/render2d/renderer-2d'
import { createSimLoop } from '@/web/scene/sim/loop'
import { bringIntoView, view } from '@/web/scene/view'
import { ROOMS, roomById } from '@/web/scene/world/rooms'
import { breakpoint } from '@/web/state/breakpoints'
import { focusRequest } from '@/web/state/focus'
import { findRun } from '@/web/state/live'
import { unread } from '@/web/state/notices'
import { colorScheme, lampsOff, lightByHour } from '@/web/state/prefs'
import { state } from '@/web/state/session'
import { MINUTES_PER_HOUR } from '@/web/text/time'

import './canvas.css'

const NO_ACTORS: SimView['actors'] = Object.freeze([])

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
  useEffect(() => effect(answerFocusRequest), [])

  return (
    <div class="scene">
      <div ref={host} class="scene-host" />
      <RoomTags renderer={renderer} />
      <BoardButtons renderer={renderer} />
      <ObjectTip />
      <Toolbar />
      <PerfReadout renderer={renderer} />
    </div>
  )
}

// Everything it arms, the returned stop releases: data reads, loop, input, observer, listeners and
// the renderer.
function mountScene(element: HTMLElement, renderer: SceneRenderer): () => void {
  const listeners = new AbortController()
  const stops = [startHome(), startBoard(), startRoomStatus(), startAgenda()]

  renderer.mount(element)

  const loop = createSimLoop({
    step: () => false,
    draw: (alpha, now) => renderer.draw(buildSimView(alpha), now),
    resume: () => undefined,
    nextDueAt: () => Number.POSITIVE_INFINITY,
  })
  const resize = new ResizeObserver(() => loop.wake())
  const canvas = element.querySelector('canvas')
  const detach = canvas === null ? () => undefined : attachInteraction(canvas, { renderer })
  const stopWake = effect(() => {
    readSceneInputs()
    untracked(loop.wake)
  })

  resize.observe(element)
  watchResolution(loop.wake, listeners.signal)
  loop.start()

  return () => {
    stopWake()
    detach()
    loop.stop()
    resize.disconnect()
    listeners.abort()
    renderer.unmount()

    for (const stop of stops) {
      stop()
    }
  }
}

function buildSimView(alpha: number): SimView {
  const off = lampsOff.value
  const lit = new Set<RoomId>(ROOMS.filter((room) => !off.has(room.id)).map((room) => room.id))

  return {
    floor: view.value.floor,
    alpha,
    actors: NO_ACTORS,
    props: { lit },
    light: { hour: pageMinute.value.minute / MINUTES_PER_HOUR, followsHour: lightByHour.value },
  }
}

// What the picture shows besides the sim: a change to any of these draws a frame.
function readSceneInputs(): void {
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

// "Xem" on a run: its room comes into view, on its floor; a run with no room moves nothing.
function answerFocusRequest(): void {
  const request = focusRequest.value

  if (request === undefined) {
    return
  }

  untracked(() => {
    const run = findRun(request.runId)
    const roomId = run === undefined ? undefined : roomOfRun(run)
    const room = roomId === undefined ? undefined : roomById(roomId)

    if (room !== undefined) {
      bringIntoView({ floor: room.floor, rect: room.rect, room: { id: room.id, rect: room.rect } })
    }
  })
}
