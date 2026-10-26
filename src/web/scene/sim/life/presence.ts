import type { ActorState } from '@/web/scene/sim/director'
import type { LifeState, LifeStep } from '@/web/scene/sim/life/state'
import type { Goal } from '@/web/scene/sim/vocabulary'
import type { ActorId, FloorId, LifeLine, RoomId } from '@/web/scene/types'
import type { OfficeLife } from '@/web/scene/world/regions'
import type { ClockParts } from '@/web/text/time'
import { pageMinute } from '@/web/scene/clock/clock'
import { homeMarket, regionPack } from '@/web/scene/data/home'
import { isWalking } from '@/web/scene/sim/actors/walk'
import { drawBetween } from '@/web/scene/sim/life/state'
import { deskHolds, moment } from '@/web/scene/sim/rhythm'
import { STREET_DOOR } from '@/web/scene/world/doors'
import { isInRange } from '@/web/scene/world/regions'
import { roomAt } from '@/web/scene/world/rooms'
import { findRun } from '@/web/state/live'
import { lampsOff } from '@/web/state/prefs'
import { formatRunName } from '@/web/text/run-name'

// At most this many people are on the way through the street door at once.
const MAX_TRIPS = 3
// A walk to or from the street door that takes longer ends where it stands.
const TRIP_LEG_MS = 30_000
// A clock that moves more than this between two steps was set, not run: the office follows it at
// once.
const JUMP_MINUTES = 5
/** The floor the office's staff work on. */
export const OFFICE_FLOOR: FloorId = 'office'
const TEAM_ROOM: RoomId = 'team'
const NAP_DIM = 0.72

/** One person's own minutes of arriving and leaving today. */
interface Shift {
  readonly arriveAt: number
  readonly leaveAt: number
}

/** A person on the way through the street door: the door goal a leaving person was given, and
 *  when they set off (a `performance.now()` instant). */
interface Trip {
  readonly goal: Goal | undefined
  readonly sinceMs: number
}

/** What the market's rhythm keeps between steps: who is on the way in or out, each one's shift
 *  today, the rooms someone stands in, the lines the day puts over people, and when the mood
 *  last gathered people. Every map grows only to the roster. */
export interface RhythmState {
  readonly trips: Map<ActorId, Trip>
  readonly shifts: Map<ActorId, Shift>
  readonly occupied: Set<RoomId>
  lines: readonly LifeLine[]
  shiftDay: string | undefined
  seenAt: ClockParts | undefined
  moodNoticeId: string | undefined
  moodAt: number
}

export function createRhythmState(): RhythmState {
  return {
    trips: new Map(),
    shifts: new Map(),
    occupied: new Set(),
    lines: [],
    shiftDay: undefined,
    seenAt: undefined,
    moodNoticeId: undefined,
    moodAt: Number.NEGATIVE_INFINITY,
  }
}

/** The person is in the office (or walking in or out of it), not gone home. */
export function isPresent(actor: ActorState): boolean {
  return actor.away !== 'gone'
}

/** Before the office fills and after it empties, and all of a rest day, a lamp is lit only where
 *  someone really is; by day it follows its own switch. A switched-off lamp stays off. */
export function isRoomLit(room: RoomId, occupied: ReadonlySet<RoomId>): boolean {
  return !lampsOff.value.has(room) && (!isAfterHours() || occupied.has(room))
}

/** How far the lamps that are on glow: dimmed over the lunch nap by the page clock. */
export function lampGlowOf(): number {
  const isNap = isInRange(pageMinute.value.minute, regionPack.value.officeLife.nap)

  return isNap ? NAP_DIM : 1
}

/** Brings people in and sends them home by the market's day: each person has their own minutes
 *  inside the pack's arrival and leaving windows, a rest day keeps only its staff, and a real run
 *  keeps its person in (or brings them in) however late. They walk through the street door, a few
 *  at a time; a clock that was set, reduced motion and a hidden pane put them in or out at once. */
export function stepPresence(state: LifeState, step: LifeStep): void {
  const { rhythm } = state

  if (homeMarket.value !== undefined) {
    const isInstant = !step.canWalk || isJump(rhythm.seenAt, step.clock)

    settleTrips(state, step)
    startTrips(state, { step, isInstant })
    rhythm.seenAt = step.clock
  }

  noteRooms(state, step)
  rhythm.lines = linesOf(state, step)
}

function isJump(seen: ClockParts | undefined, clock: ClockParts): boolean {
  return (
    seen === undefined ||
    seen.day !== clock.day ||
    Math.abs(seen.minute - clock.minute) > JUMP_MINUTES
  )
}

function isAfterHours(): boolean {
  const { arrive, leave } = regionPack.value.officeLife
  const { minute } = pageMinute.value

  return !moment.value.tradingDay || minute < arrive[0] || minute >= leave[1]
}

// On a rest day the pack's staff are in; a real run (a goal the live store calls for) keeps its
// person in any day.
function isFixture(actor: ActorState): boolean {
  return !moment.value.tradingDay && regionPack.value.restDayStaff.includes(actor.def.id)
}

function hasRealRun(actor: ActorState): boolean {
  return actor.goal !== undefined && !actor.isLife
}

function isOnShift(rhythm: RhythmState, at: { actor: ActorState; step: LifeStep }): boolean {
  const { minute } = at.step.clock
  const shift = shiftOf(rhythm, at)

  return moment.value.tradingDay && minute >= shift.arriveAt && minute < shift.leaveAt
}

function isWanted(rhythm: RhythmState, at: { actor: ActorState; step: LifeStep }): boolean {
  return isFixture(at.actor) || hasRealRun(at.actor) || isOnShift(rhythm, at)
}

function shiftOf(rhythm: RhythmState, at: { actor: ActorState; step: LifeStep }): Shift {
  const { day } = at.step.clock
  const id = at.actor.def.id
  const { arrive, leave }: OfficeLife = at.step.pack

  if (rhythm.shiftDay !== day) {
    rhythm.shifts.clear()
    rhythm.shiftDay = day
  }

  const held = rhythm.shifts.get(id)

  if (held !== undefined) {
    return held
  }

  const shift = {
    arriveAt: drawBetween({ min: arrive[0], max: arrive[1] }, 'arrive', id, day),
    leaveAt: drawBetween({ min: leave[0], max: leave[1] }, 'leave', id, day),
  }

  rhythm.shifts.set(id, shift)

  return shift
}

// A person on the way out who is called away (a run, a meeting, a gesture) turns back to their
// goal; one who reaches the door, or takes too long, is gone. One on the way in is in once they
// stand at their seat.
function settleTrips(state: LifeState, step: LifeStep): void {
  const { director, rhythm } = state

  for (const [id, trip] of rhythm.trips) {
    const actor = step.actors.get(id)
    const stage = director.away.get(id)

    if (actor === undefined || stage === undefined) {
      rhythm.trips.delete(id)
    } else if (stage === 'leaving') {
      settleLeaving(state, { id, actor, trip, nowMs: step.nowMs })
    } else if (stage === 'arriving') {
      settleArriving(state, { id, actor, trip, nowMs: step.nowMs })
    }
  }
}

interface TripAt {
  readonly id: ActorId
  readonly actor: ActorState
  readonly trip: Trip
  readonly nowMs: number
}

function settleLeaving(state: LifeState, at: TripAt): void {
  const { director, rhythm } = state

  if (isCalled(at.actor, at.trip)) {
    director.away.delete(at.id)
    director.setLife(at.id, undefined)
    rhythm.trips.delete(at.id)
  } else if (isSettledOrLate(at)) {
    goneHome(state, at.id)
    rhythm.trips.delete(at.id)
  }
}

function settleArriving(state: LifeState, at: TripAt): void {
  if (!isSettledOrLate(at)) {
    return
  }

  if (!isSettled(at.actor)) {
    state.director.enter(at.id, true)
  }

  state.director.away.delete(at.id)
  state.rhythm.trips.delete(at.id)
}

function isSettled(actor: ActorState): boolean {
  return actor.isSettled && !isWalking(actor.walker)
}

function isSettledOrLate(at: TripAt): boolean {
  return isSettled(at.actor) || at.nowMs - at.trip.sinceMs > TRIP_LEG_MS
}

function isCalled(actor: ActorState, trip: Trip): boolean {
  return actor.goal !== trip.goal || actor.beats.some((beat) => beat.kind !== 'life')
}

function goneHome(state: LifeState, id: ActorId): void {
  state.director.away.set(id, 'gone')
  state.director.setLife(id, undefined)
}

// Those wanted in who are gone come in; those free and no longer wanted go. Past `MAX_TRIPS` the
// rest wait for the next step.
function startTrips(
  state: LifeState,
  at: { readonly step: LifeStep; readonly isInstant: boolean }
): void {
  const { step, isInstant } = at
  const { director, rhythm } = state
  const wanted = (actor: ActorState): boolean => isWanted(rhythm, { actor, step })
  const arrivals = [...step.actors.values()].filter(
    (actor) => actor.away === 'gone' && !rhythm.trips.has(actor.def.id) && wanted(actor)
  )
  const leavers = step.free.filter((actor) => !wanted(actor))

  for (const actor of arrivals) {
    if (!isInstant && rhythm.trips.size >= MAX_TRIPS) {
      return
    }

    director.enter(actor.def.id, isInstant)

    if (isInstant) {
      director.away.delete(actor.def.id)
    } else {
      director.away.set(actor.def.id, 'arriving')
      rhythm.trips.set(actor.def.id, { goal: undefined, sinceMs: step.nowMs })
    }
  }

  for (const actor of leavers) {
    if (!isInstant && rhythm.trips.size >= MAX_TRIPS) {
      return
    }

    sendHome(state, { id: actor.def.id, nowMs: step.nowMs, isInstant })
  }
}

function sendHome(
  state: LifeState,
  at: { readonly id: ActorId; readonly nowMs: number; readonly isInstant: boolean }
): void {
  const { director, rhythm } = state

  if (at.isInstant) {
    goneHome(state, at.id)
    return
  }

  const goal: Goal = { kind: 'life', target: STREET_DOOR, pose: 'idle', since: at.nowMs }

  director.setLife(at.id, goal)
  director.away.set(at.id, 'leaving')
  rhythm.trips.set(at.id, { goal, sinceMs: at.nowMs })
}

// The rooms someone stands in, for the lamps.
function noteRooms(state: LifeState, step: LifeStep): void {
  const { occupied } = state.rhythm

  occupied.clear()

  for (const actor of step.actors.values()) {
    const room =
      isPresent(actor) && actor.floor === OFFICE_FLOOR
        ? roomAt(OFFICE_FLOOR, actor.walker.pos)
        : undefined

    if (room !== undefined) {
      occupied.add(room.id)
    }
  }

  if (isAfterHours() && state.teamDesks().some((desk) => desk.isTaken)) {
    occupied.add(TEAM_ROOM)
  }
}

// What the day keeps people at their desks for, and a run that goes on past its person's shift.
function linesOf(state: LifeState, step: LifeStep): LifeLine[] {
  const lines: LifeLine[] = [...deskHolds.value]

  for (const actor of step.actors.values()) {
    const runId = actor.goal?.runId
    const run = runId === undefined || !isPresent(actor) ? undefined : findRun(runId)

    if (run !== undefined && !isFixture(actor) && !isOnShift(state.rhythm, { actor, step })) {
      lines.push({ actor: actor.def.id, label: 'overtime', what: formatRunName(run) })
    }
  }

  return lines
}
