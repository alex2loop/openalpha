import type { WireEvent } from '@/app/server/wire/events'
import type { ActorState } from '@/web/scene/sim/director'
import type { LifeView } from '@/web/scene/types'
import type { onWireEvent } from '@/web/state/events'
import { pageMinute } from '@/web/scene/clock/clock'
import { distance } from '@/web/scene/sim/actors/nav'
import { ASSISTANT } from '@/web/scene/sim/actors/roster'
import { begin } from '@/web/scene/sim/life/schedule'
import {
  drawBetween,
  isAtSeat,
  type LifeAsk,
  type LifeState,
  type LifeStep,
  seatPoseOf,
} from '@/web/scene/sim/life/state'
import { roomAt } from '@/web/scene/world/rooms'
import { BOARD_SPOTS } from '@/web/scene/world/seats'
import { setCapped } from '@/web/state/capped-map'

const CAT_AWAKE_MS = 8_000
const MAX_WOKEN = 200
const MAX_VERDICTS = 32
const MAX_ASKS = 16
const MAX_SHEETS = 6
// A sheet slides out of the printer over this long, then joins the stack.
const PRINT_FEED_MS = 900
const BRIEF_NAME = 'brief'
const RESEARCH_NAME = 'research'
const COMPLETED = 'completed'
const ABORTED = 'aborted'
const HANDS_MS = 1_800
const LOOK_MS = 2_600
const WATCH_MS = Object.freeze({ min: 5_000, max: 8_000 })
const STANDUP_MS = Object.freeze({ min: 60_000, max: 120_000 })
const STANDUP_STAGGER_MS = 1_500
const STANDUP_MIN = 2
const STANDUP_MAX = 4
// Who turns to look, and who comes to stand behind the chair, from this near at most.
const NEIGHBOUR_PX = 140
const WATCH_FROM_PX = 260
// Behind the chair: beside it and a step back from where the seat looks.
const BEHIND_SIDE_PX = 10
const BEHIND_BACK_PX = 18
const MINUTE_KEY_SEPARATOR = ':'

/** Hears the wire for the office life; the returned stop unsubscribes. Each handler only records:
 *  the step acts. */
export function subscribeLife(hub: typeof onWireEvent, state: LifeState): () => void {
  const offs = [
    hub('run_started', (event) => onStarted(state, event)),
    hub('run_finished', (event) => onFinished(state, event)),
    hub('idea', (event) => {
      if (event.runId !== undefined) {
        setCapped(state.verdicts, [event.runId, true], MAX_VERDICTS)
      }
    }),
    hub('brief_ready', () => feedSheet(state)),
    hub('any', (event) => wakeCat(state, event)),
  ]

  return () => {
    for (const off of offs) {
      off()
    }
  }
}

function onStarted(state: LifeState, event: WireEvent): void {
  const run = event.run

  if (event.runId === undefined || run === undefined) {
    return
  }

  setCapped(state.runNames, [event.runId, run.name], MAX_VERDICTS)

  if (run.name === BRIEF_NAME && run.parentRunId === undefined) {
    ask(state.asks, { kind: 'standup' })
  }
}

function onFinished(state: LifeState, event: WireEvent): void {
  if (event.runId === undefined || event.outcome === undefined) {
    return
  }

  if (event.outcome === COMPLETED && state.runNames.get(event.runId) === RESEARCH_NAME) {
    feedSheet(state)
  }

  // The red dot is a record, kept even while the tab is hidden; the gestures are the step's.
  if (isFailure(event.outcome)) {
    for (const id of state.director.actorsOfRun(event.runId)) {
      state.failed.add(id)
    }
  }

  ask(state.asks, { kind: 'finished', runId: event.runId, outcome: event.outcome })
}

function isFailure(outcome: string): boolean {
  return outcome !== COMPLETED && outcome !== ABORTED
}

function ask(asks: LifeAsk[], next: LifeAsk): void {
  asks.push(next)
  asks.splice(0, Math.max(0, asks.length - MAX_ASKS))
}

// A delivered report feeds a sheet out of the printer; the stack is cleared at the next hour.
function feedSheet(state: LifeState): void {
  state.sheets = {
    hour: state.sheets.hour,
    count: Math.min(MAX_SHEETS, state.sheets.count + 1),
    feedAt: performance.now(),
  }
}

// Each thing wakes the cat once: an approval, a stop or alert, a fill, a spent budget (what the
// daemon marks `wake`), never the same request, alert or run twice.
function wakeCat(state: LifeState, event: WireEvent): void {
  if (event.wake !== true) {
    return
  }

  const key = event.requestId ?? event.alert?.alertId ?? event.runId ?? minuteKeyOf(event)

  if (state.woken.has(key)) {
    return
  }

  setCapped(state.woken, [key, true], MAX_WOKEN)
  state.catAwakeUntil = performance.now() + CAT_AWAKE_MS
}

function minuteKeyOf(event: WireEvent): string {
  const { day, minute } = pageMinute.value

  return [event.kind, day, String(Math.floor(minute))].join(MINUTE_KEY_SEPARATOR)
}

/** The asks the wire left, acted on in turn: a stand-up, a finished run's hands, look or watch,
 *  and its error mark. Recorded even under reduced motion; moved only when the office may walk. */
export function stepAsks(state: LifeState, step: LifeStep): void {
  for (const next of state.asks.splice(0)) {
    if (next.kind === 'standup') {
      gatherStandup(state, step)
    } else {
      afterRun(state, step, next)
    }
  }
}

function afterRun(
  state: LifeState,
  step: LifeStep,
  done: Extract<LifeAsk, { kind: 'finished' }>
): void {
  const owners = state.director.actorsOfRun(done.runId)
  const owner = owners[0] === undefined ? undefined : step.actors.get(owners[0])

  if (owner === undefined || !step.canWalk) {
    return
  }

  if (done.outcome === COMPLETED) {
    cheer(state, step, { owner, runId: done.runId })
  } else if (isFailure(done.outcome)) {
    sendWatcher(state, step, owner)
  }
}

// The owner raises both hands and the free neighbour turns; the mascot cheers only for work that
// gave no verdict.
function cheer(state: LifeState, step: LifeStep, done: { owner: ActorState; runId: string }): void {
  const { owner } = done
  const isAssistant = owner.def.id === ASSISTANT

  if (!(isAssistant && state.verdicts.has(done.runId))) {
    state.director.play(owner.def.id, { pose: isAssistant ? 'cheer' : 'hands-up', ms: HANDS_MS })
  }

  const neighbour = nearestFree(step, { to: owner, withinPx: NEIGHBOUR_PX })

  if (neighbour !== undefined) {
    begin(state, { actor: neighbour, kind: 'look', nowMs: step.nowMs }, [
      { pose: seatPoseOf(neighbour), face: owner.def.id, holdMs: LOOK_MS },
    ])
  }
}

function sendWatcher(state: LifeState, step: LifeStep, owner: ActorState): void {
  const isWatched = [...state.moments.values()].some((moment) => moment.kind === 'watch')
  const watcher = nearestFree(step, { to: owner, withinPx: WATCH_FROM_PX })

  if (isWatched || watcher === undefined) {
    return
  }

  const seat = owner.def.seat
  const back = seat.face === 'up' ? BEHIND_BACK_PX : -BEHIND_BACK_PX
  const at = { x: seat.at.x + BEHIND_SIDE_PX, y: seat.at.y + back }

  begin(state, { actor: watcher, kind: 'watch', nowMs: step.nowMs }, [
    {
      at,
      pose: 'watch',
      face: owner.def.id,
      holdMs: drawBetween(WATCH_MS, 'watch', String(step.nowMs)),
    },
  ])
}

// Two to four free people of the office floor gather at the meeting room's whiteboard.
function gatherStandup(state: LifeState, step: LifeStep): void {
  const board = BOARD_SPOTS[0]
  const isGathered = [...state.moments.values()].some((moment) => moment.kind === 'standup')

  if (!step.canWalk || board === undefined || isGathered) {
    return
  }

  const near = step.free
    .filter((actor) => actor.def.floor === 'office' && isAtSeat(actor))
    .sort((a, b) => distance(a.walker.pos, board) - distance(b.walker.pos, board))
  const count = Math.min(near.length, BOARD_SPOTS.length, STANDUP_MAX)
  const holdMs = drawBetween(STANDUP_MS, 'standup', String(step.nowMs))

  if (count < STANDUP_MIN) {
    return
  }

  near.slice(0, count).forEach((actor, i) => {
    const at = BOARD_SPOTS[i] ?? board
    const line = i === 0 ? { actor: actor.def.id, label: 'standup' as const } : undefined

    begin(
      state,
      { actor, kind: 'standup', nowMs: step.nowMs, ...(line === undefined ? {} : { line }) },
      [{ at, pose: i === 0 ? 'point' : 'idle', holdMs: holdMs + i * STANDUP_STAGGER_MS }]
    )
  })
}

function nearestFree(
  step: LifeStep,
  near: { readonly to: ActorState; readonly withinPx: number }
): ActorState | undefined {
  const at = near.to.walker.pos

  return step.free
    .filter(
      (actor) =>
        actor !== near.to &&
        actor.def.floor === near.to.def.floor &&
        isAtSeat(actor) &&
        roomAt(actor.def.floor, actor.walker.pos) !== undefined &&
        distance(actor.walker.pos, at) < near.withinPx
    )
    .sort((a, b) => distance(a.walker.pos, at) - distance(b.walker.pos, at))[0]
}

/** How far the newest sheet has come out of the printer (1 once it lies on the stack). */
export function feedKOf(life: LifeView, now: number): number {
  const feedAt = life.feedAt

  return feedAt === undefined ? 1 : Math.min(1, Math.max(0, (now - feedAt) / PRINT_FEED_MS))
}
