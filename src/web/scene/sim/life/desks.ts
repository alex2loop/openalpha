import type { ActivityResponse } from '@/app/server/wire/activity'
import type { ActorState } from '@/web/scene/sim/director'
import type { LifeState, LifeStep } from '@/web/scene/sim/life/state'
import type { ActorId, DeskSession, DeskTrace, MonitorState, RoomId } from '@/web/scene/types'
import type { ClockParts } from '@/web/text/time'
import { pageMinute } from '@/web/scene/clock/clock'
import { homeIndex, type LedItem } from '@/web/scene/data/led'
import { roomOfRun } from '@/web/scene/data/room-status'
import { todayRuns } from '@/web/scene/data/today-runs'
import { distance } from '@/web/scene/sim/actors/nav'
import { rosterDefOf } from '@/web/scene/sim/actors/roster'
import { homePhase } from '@/web/scene/sim/rhythm'
import {
  DESK_CUP_SLOTS,
  DESK_PROPS,
  DESK_SHEET_SLOTS,
  isScreen,
} from '@/web/scene/world/desk-props'
import { setCapped } from '@/web/state/capped-map'
import { hasUnreadAlert } from '@/web/state/notices'
import { PERCENT } from '@/web/text/figures'
import { MINUTES_PER_HOUR, shiftDay } from '@/web/text/time-units'

/** A screensaver steps this often; under reduced motion it stays still. */
const SAVER_STEP_MS = 2_500
// The desks are tidied at this minute of the page clock, before the day's work starts.
const DAY_START_MINUTE = 6 * MINUTES_PER_HOUR
// Someone within this of their seat is at their desk.
const AT_DESK_PX = 12
// One cup more than the slots: the one in hand is not on the desk.
const MAX_CUPS = DESK_CUP_SLOTS + 1
// A day's runs already counted, so a run the first read and the wire both report counts once.
const MAX_COUNTED_RUNS = 64
const COMPLETED = 'completed'
const DESK_OWNERS: readonly ActorId[] = [...new Set(DESK_PROPS.map((row) => row.owner))]
const SCREEN_OWNERS: readonly ActorId[] = [
  ...new Set(DESK_PROPS.filter(isScreen).map((row) => row.owner)),
]
// A run's room puts a sheet on the desks of the people who work there.
const OWNERS_BY_ROOM: ReadonlyMap<RoomId, readonly ActorId[]> = ownersByRoom()

interface Tally {
  cups: number
  sheets: number
}

/** The view the renderers read, kept in place: no step allocates a new one. */
interface ShownDesks {
  readonly mess: Map<ActorId, Tally>
  readonly monitors: Map<ActorId, MonitorState>
  session: DeskSession
  trace: DeskTrace | undefined
  isAlertOn: boolean
  saverStep: number
  signature: number
}

/** The day's mess on each desk, raw, and what the desks show of it. Kept for the page's life, never
 *  stored: a reload starts again from today's finished runs. */
export interface Desks {
  readonly tallies: ReadonlyMap<ActorId, Tally>
  readonly counted: Map<string, true>
  readonly shown: ShownDesks
  day: string | undefined
  seeded: ActivityResponse | undefined
  indexItem: LedItem | undefined
  hasSaver: boolean
}

export function createDesks(): Desks {
  return {
    tallies: new Map(DESK_OWNERS.map((owner) => [owner, { cups: 0, sheets: 0 }])),
    counted: new Map(),
    shown: {
      mess: new Map(DESK_OWNERS.map((owner) => [owner, { cups: 0, sheets: 0 }])),
      monitors: new Map(),
      session: 'closed',
      trace: undefined,
      isAlertOn: false,
      saverStep: 0,
      signature: 0,
    },
    day: undefined,
    seeded: undefined,
    indexItem: undefined,
    hasSaver: false,
  }
}

/** Someone came back from a break with a cup: it joins their desk. */
export function addCup(desks: Desks, owner: ActorId): void {
  rollDay(desks, pageMinute.value)

  const tally = desks.tallies.get(owner)

  if (tally !== undefined) {
    tally.cups = Math.min(MAX_CUPS, tally.cups + 1)
  }
}

/** A run finished `completed`: one sheet on the desk of each of its people, once per run. */
export function addRunSheets(
  desks: Desks,
  run: { readonly runId: string; readonly outcome: string; readonly owners: readonly ActorId[] }
): void {
  rollDay(desks, pageMinute.value)

  if (run.outcome !== COMPLETED || desks.counted.has(run.runId)) {
    return
  }

  setCapped(desks.counted, [run.runId, true], MAX_COUNTED_RUNS)

  for (const owner of run.owners) {
    const tally = desks.tallies.get(owner)

    if (tally !== undefined) {
      tally.sheets = Math.min(DESK_SHEET_SLOTS, tally.sheets + 1)
    }
  }
}

/** Tidies the desks at the day's start, seeds them once from today's finished runs, and brings
 *  what they show up to date; the signature moves only when something shown changed. */
export function stepDesks(state: LifeState, step: LifeStep): void {
  const { desks } = state

  rollDay(desks, step.clock)
  seedDesks(desks)

  const isMessChanged = syncMess(state, step)
  const isScreenChanged = syncScreens(desks, step)

  if (isMessChanged || isScreenChanged) {
    desks.shown.signature++
  }
}

/** When a screensaver on show steps next, a `performance.now()` instant. */
export function deskDueOf(desks: Desks, nowMs: number): number {
  return desks.hasSaver
    ? (Math.floor(nowMs / SAVER_STEP_MS) + 1) * SAVER_STEP_MS
    : Number.POSITIVE_INFINITY
}

// The desks' day runs from `DAY_START_MINUTE` to the same minute the next morning.
function rollDay(desks: Desks, clock: ClockParts): void {
  const day = clock.minute < DAY_START_MINUTE ? shiftDay(clock.day, -1) : clock.day

  if (desks.day === day) {
    return
  }

  desks.day = day
  desks.counted.clear()

  for (const tally of desks.tallies.values()) {
    tally.cups = 0
    tally.sheets = 0
  }
}

// A page opened late is not tidy: each run today's read lists as completed lays a sheet on the
// desk of everyone who works in its room. Cups come only from breaks seen on the page.
function seedDesks(desks: Desks): void {
  const read = todayRuns.value

  if (read === undefined || read === desks.seeded) {
    return
  }

  desks.seeded = read

  for (const row of read.rows) {
    const room = roomOfRun(row)
    const owners = room === undefined ? [] : (OWNERS_BY_ROOM.get(room) ?? [])

    addRunSheets(desks, { runId: row.runId, outcome: row.outcome, owners })
  }
}

function ownersByRoom(): Map<RoomId, ActorId[]> {
  const byRoom = new Map<RoomId, ActorId[]>()

  for (const owner of DESK_OWNERS) {
    const room = rosterDefOf(owner)?.room

    if (room !== undefined) {
      byRoom.set(room, [...(byRoom.get(room) ?? []), owner])
    }
  }

  return byRoom
}

// A cup in hand is not drawn again on the desk.
function syncMess(state: LifeState, step: LifeStep): boolean {
  let isChanged = false

  for (const [owner, tally] of state.desks.tallies) {
    const shown = state.desks.shown.mess.get(owner)
    const isCupInHand = state.mugs.has(owner) && step.actors.get(owner)?.goal?.item === 'cup'
    const onDesk = isCupInHand ? tally.cups - 1 : tally.cups
    const cups = Math.max(0, Math.min(DESK_CUP_SLOTS, onDesk))

    if (shown !== undefined && (shown.cups !== cups || shown.sheets !== tally.sheets)) {
      shown.cups = cups
      shown.sheets = tally.sheets
      isChanged = true
    }
  }

  return isChanged
}

function syncScreens(desks: Desks, step: LifeStep): boolean {
  const { shown } = desks
  const session = sessionOf()
  const isAlertOn = hasUnreadAlert.value
  const isTraceChanged = syncTrace(desks)
  let isChanged = isTraceChanged || shown.session !== session || shown.isAlertOn !== isAlertOn

  shown.session = session
  shown.isAlertOn = isAlertOn
  desks.hasSaver = false

  for (const owner of SCREEN_OWNERS) {
    const actor = step.actors.get(owner)
    const next = actor === undefined ? 'off' : monitorOf(actor, { step, session })

    desks.hasSaver = desks.hasSaver || next === 'saver'

    if (shown.monitors.get(owner) !== next) {
      isChanged = true

      if (next === undefined) {
        shown.monitors.delete(owner)
      } else {
        shown.monitors.set(owner, next)
      }
    }
  }

  return syncSaver(desks, step) || isChanged
}

// Absent while the owner works: the work screen shows.
function monitorOf(
  actor: ActorState,
  at: { readonly step: LifeStep; readonly session: DeskSession }
): MonitorState | undefined {
  if (actor.goal?.kind === 'work') {
    return undefined
  }

  if (at.step.isQuiet || actor.floor !== actor.def.floor) {
    return 'off'
  }

  if (distance(actor.walker.pos, actor.def.seat.at) > AT_DESK_PX) {
    return 'saver'
  }

  return at.session === 'open' ? 'live' : 'rest'
}

// True when the home index read changed what the live monitors draw.
function syncTrace(desks: Desks): boolean {
  const item = homeIndex.value

  if (item === desks.indexItem) {
    return false
  }

  desks.indexItem = item
  desks.shown.trace = traceOf(item)

  return true
}

// A move the wire left out, or a read that went stale, draws no line.
function traceOf(item: LedItem | undefined): DeskTrace | undefined {
  if (
    item === undefined ||
    item.stale ||
    item.level === undefined ||
    item.changePct === undefined ||
    item.line.length < 2
  ) {
    return undefined
  }

  return {
    label: item.label,
    line: item.line,
    close: item.level / (1 + item.changePct / PERCENT),
    changePct: item.changePct,
  }
}

function syncSaver(desks: Desks, step: LifeStep): boolean {
  const saverStep = desks.hasSaver && !step.isReduced ? Math.floor(step.nowMs / SAVER_STEP_MS) : 0

  if (desks.shown.saverStep === saverStep) {
    return false
  }

  desks.shown.saverStep = saverStep

  return true
}

// A market without session hours always trades.
function sessionOf(): DeskSession {
  const phase = homePhase.value

  if (phase === undefined || phase === 'open') {
    return 'open'
  }

  return phase === 'break' ? 'break' : 'closed'
}
