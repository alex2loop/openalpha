import type { ActorState } from '@/web/scene/sim/director'
import type { LifeState, LifeStep } from '@/web/scene/sim/life/state'
import type { Goal } from '@/web/scene/sim/vocabulary'
import type { ActorId, CrewRole, Point } from '@/web/scene/types'
import type { ClockParts } from '@/web/text/time'
import { homeMarket, regionPack } from '@/web/scene/data/home'
import { CREW_IDS } from '@/web/scene/sim/actors/roster'
import { isWalking } from '@/web/scene/sim/actors/walk'
import { setBlock } from '@/web/scene/sim/life/blocks'
import {
  beginMoment,
  type Moment,
  type StopSpec,
  stepMoment,
  toStop,
} from '@/web/scene/sim/life/moments'
import { goneHome, isJump, TRIP_LEG_MS } from '@/web/scene/sim/life/presence'
import { ROUND_DOORS } from '@/web/scene/sim/life/rounds'
import { isAtSeat } from '@/web/scene/sim/life/state'
import { approachOf } from '@/web/scene/sim/places'
import { moment as marketMoment } from '@/web/scene/sim/rhythm'
import { SEAT_TARGET } from '@/web/scene/sim/vocabulary'
import { DOORS, STREET_DOOR } from '@/web/scene/world/doors'
import { FLOORS, GROUND_FLOOR } from '@/web/scene/world/floors'
import { propsOn, wetSignRectOf } from '@/web/scene/world/props'
import { isWithin } from '@/web/scene/world/regions'
import { CREW_POSTS } from '@/web/scene/world/seats'
import { MINUTES_PER_HOUR } from '@/web/text/time-units'

const RECEPTIONIST: CrewRole = 'receptionist'
const GUARD: CrewRole = 'guard'
const CLEANER: CrewRole = 'cleaner'
/** The receptionist nods to each person crossing the west door at most this often. */
const NOD_GAP_MS = 9_000
const NOD_MS = 950
const GUARD_TURN_MS = 1_600
const ROUND_LOOK_MS = 2_400
// A round starts within this many minutes past the hour, or waits for the next.
const ROUND_START_MINUTES = 5
const BIN_MS = 2_200
const BAG_MS = 900
const MOP_REST_MS = 1_800
// The front desk watches the west doorway, this far into the lobby and either side of it.
const WATCH_PX = Object.freeze({ depth: 46, side: 6 })
const WEST_DOOR = DOORS.office.find((door) => door.isWest === true)
// Five spans of the corridor, mopped west to east, the sign hopping ahead on its south edge.
const MOP = Object.freeze({ spans: 5, fromX: 40, spanPx: 110, rowDy: 9, signDy: 27, signBack: 6 })
const CORRIDOR = FLOORS.office.corridor ?? { x: 0, y: 0, w: 0, h: 0 }
// The operator room's bin, where the shift ends.
const DESK_BIN_PROP = propsOn(GROUND_FLOOR).find(
  (prop) => prop.kind === 'bin' && prop.room === 'desk'
)
const DESK_BIN: Point =
  DESK_BIN_PROP === undefined ? CREW_POSTS.cleaner.at : approachOf(DESK_BIN_PROP)

/** What the building crew keep between steps: the guard's round and the cleaner's shift under
 *  way (with the sign's place at each stop), whom the receptionist nodded to last, the hour of
 *  the last round, the day the corridor was mopped, and who is on the way out. Every map grows
 *  only to the crew or the roster. */
export interface CrewState {
  readonly moments: Map<CrewRole, Moment>
  readonly leaving: Map<CrewRole, { readonly goal: Goal; readonly sinceMs: number }>
  readonly nodAt: Map<ActorId, number>
  signs: readonly (Point | undefined)[]
  sign: Point | undefined
  roundHour: string | undefined
  mopDay: string | undefined
  turnUntil: number
  seen: ClockParts | undefined
}

export function createCrewState(): CrewState {
  return {
    moments: new Map(),
    leaving: new Map(),
    nodAt: new Map(),
    signs: [],
    sign: undefined,
    roundHour: undefined,
    mopDay: undefined,
    turnUntil: 0,
    seen: undefined,
  }
}

/** The building crew by the pack's hours: the receptionist at the front desk on trading days, the
 *  guard at the gates always with a night round each hour, the cleaner mopping the corridor in
 *  the late afternoon of a trading day. Walks need motion; without it, and on the first step once
 *  `/v1/markets` has answered, they stand at their places at once. */
export function stepCrew(state: LifeState, step: LifeStep): void {
  if (homeMarket.value === undefined) {
    return
  }

  const { crew } = step
  const canMove = !(step.isReduced || document.hidden || isJump(state.crew.seen, step.clock))

  state.crew.seen = step.clock

  for (const id of CREW_IDS) {
    const actor = crew.get(id)

    if (actor !== undefined) {
      stepPresence(state, { id, actor, step, canMove })
    }
  }

  stepMoments(state, { crew, step, canMove })
  stepNods(state, { crew, step })
  syncSign(state)
}

function isWanted(state: LifeState, id: CrewRole, step: LifeStep): boolean {
  const hours = regionPack.value.hours.crew
  const { minute, day } = step.clock
  const { tradingDay } = marketMoment.value

  if (id === GUARD) {
    return true
  }

  if (id === RECEPTIONIST) {
    return tradingDay && isWithin(hours.receptionist, minute)
  }

  return tradingDay && isWithin(hours.cleaner, minute) && state.crew.mopDay !== day
}

interface CrewAt {
  readonly id: CrewRole
  readonly actor: ActorState
  readonly step: LifeStep
  readonly canMove: boolean
}

// In through the street door when wanted, out through it when not; at once without motion.
function stepPresence(state: LifeState, at: CrewAt): void {
  const { director, crew } = state
  const isGone = director.away.get(at.id) === 'gone'
  const wanted = isWanted(state, at.id, at.step)
  const trip = crew.leaving.get(at.id)

  if (isGone && wanted) {
    director.away.delete(at.id)
    director.enter(at.id, !at.canMove)
  } else if (!(isGone || wanted) && trip === undefined) {
    leave(state, at)
  } else if (trip !== undefined && isTripOver(at, trip)) {
    goOut(state, at.id)
  }
}

// At the street door, too long on the way, or no motion to walk it.
function isTripOver(at: CrewAt, trip: { readonly goal: Goal; readonly sinceMs: number }): boolean {
  return !at.canMove || isOut(at.actor, trip.goal) || at.step.nowMs - trip.sinceMs > TRIP_LEG_MS
}

function leave(state: LifeState, at: CrewAt): void {
  endMoment(state, at.id)

  if (!at.canMove) {
    goOut(state, at.id)
    return
  }

  const goal: Goal = {
    kind: 'life',
    target: STREET_DOOR,
    pose: 'idle',
    since: at.step.nowMs,
    ...(at.id === CLEANER ? { item: 'bag' } : {}),
  }

  state.director.setLife(at.id, goal)
  state.crew.leaving.set(at.id, { goal, sinceMs: at.step.nowMs })
}

function isOut(actor: ActorState, goal: Goal): boolean {
  return actor.goal === goal && actor.isSettled && !isWalking(actor.walker)
}

function goOut(state: LifeState, id: CrewRole): void {
  state.crew.leaving.delete(id)
  goneHome(state, id)
}

interface CrewStep {
  readonly crew: ReadonlyMap<ActorId, ActorState>
  readonly step: LifeStep
  readonly canMove: boolean
}

// The round and the shift step on; the night round starts on the hour, the shift once she is in.
function stepMoments(state: LifeState, at: CrewStep): void {
  for (const [id, moment] of state.crew.moments) {
    const actor = at.crew.get(id)
    const isRunning =
      actor !== undefined &&
      at.canMove &&
      stepMoment(state.director, moment, { actor, nowMs: at.step.nowMs }) === 'running'

    if (!isRunning) {
      endMoment(state, id)

      if (id === CLEANER && at.canMove) {
        state.crew.mopDay = at.step.clock.day
      }
    }
  }

  startRound(state, at)
  startShift(state, at)
}

function endMoment(state: LifeState, id: CrewRole): void {
  if (state.crew.moments.delete(id)) {
    state.director.setLife(id, undefined)
  }

  if (id === CLEANER) {
    state.crew.signs = []
  }
}

function begin(state: LifeState, at: { id: CrewRole; nowMs: number; stops: StopSpec[] }): void {
  const [first, ...rest] = at.stops

  if (first === undefined) {
    return
  }

  const moment = beginMoment(state.director, {
    kind: 'crew',
    actor: at.id,
    stops: [toStop(first, at.nowMs), ...rest.map((stop) => toStop(stop, at.nowMs))],
    index: 0,
    holdUntil: undefined,
  })

  state.crew.moments.set(at.id, moment)
}

// One round in each night hour, early in it: a look at each corridor door, then the gates.
function startRound(state: LifeState, at: CrewStep): void {
  const guard = at.crew.get(GUARD)
  const { minute, day } = at.step.clock
  const hour = `${day}:${Math.floor(minute / MINUTES_PER_HOUR)}`
  const isDue =
    isWithin(regionPack.value.hours.crew.nightRounds, minute) &&
    minute % MINUTES_PER_HOUR < ROUND_START_MINUTES &&
    state.crew.roundHour !== hour

  if (!(isDue && at.canMove) || guard === undefined || !isIdle(state, GUARD, guard)) {
    return
  }

  state.crew.roundHour = hour
  begin(state, {
    id: GUARD,
    nowMs: at.step.nowMs,
    stops: ROUND_DOORS.map((door) => ({
      at: door.at,
      pose: 'idle',
      look: door.door,
      holdMs: ROUND_LOOK_MS,
    })),
  })
}

// Once she is in: the lobby bin, five spans of the corridor behind the sign, the operator room's
// bin; she leaves with the bag when it is done. Without motion she stands mopping one span.
function startShift(state: LifeState, at: CrewStep): void {
  const cleaner = at.crew.get(CLEANER)
  const isDue = cleaner !== undefined && isIdle(state, CLEANER, cleaner)

  if (!(isDue && isWanted(state, CLEANER, at.step))) {
    return
  }

  if (!at.canMove) {
    const span = spanAt(at.step)

    state.director.setLife(CLEANER, mopGoal(span, at.step.nowMs))
    state.crew.signs = [signOf(span)]

    return
  }

  const shift = shiftStops()

  state.crew.signs = shift.map((stop) => stop.sign)
  begin(state, { id: CLEANER, nowMs: at.step.nowMs, stops: shift.map((stop) => stop.spec) })
}

// In, with no round, shift or way out under way; the cleaner's still mopping goal does not count.
function isIdle(state: LifeState, id: CrewRole, actor: ActorState): boolean {
  return (
    state.director.away.get(id) !== 'gone' &&
    !state.crew.moments.has(id) &&
    !state.crew.leaving.has(id) &&
    (actor.goal === undefined || id === CLEANER)
  )
}

interface ShiftStop {
  readonly spec: StopSpec
  readonly sign?: Point
}

function shiftStops(): ShiftStop[] {
  const bin = CREW_POSTS.cleaner.at
  const spans = Array.from({ length: MOP.spans }, (_, i) => mopSpan(i)).flat()

  return [
    { spec: { at: bin, pose: 'reach', holdMs: BIN_MS } },
    { spec: { at: bin, pose: 'idle', item: 'bag', holdMs: BAG_MS } },
    ...spans,
    { spec: { at: DESK_BIN, pose: 'reach', holdMs: BIN_MS } },
    { spec: { at: DESK_BIN, pose: 'idle', item: 'bag', holdMs: BAG_MS } },
  ]
}

// One span: the sign hops to its middle, the mop goes there and back twice, then a rest by it.
function mopSpan(index: number): ShiftStop[] {
  const sign = signOf(index)
  const from = { x: MOP.fromX + index * MOP.spanPx, y: CORRIDOR.y + MOP.rowDy }
  const to = { x: from.x + MOP.spanPx, y: from.y }
  const stroke = (point: Point, holdMs = 0): ShiftStop => ({
    spec: { at: point, pose: 'idle', item: 'mop', holdMs },
    sign,
  })

  return [stroke(from), stroke(to), stroke(from), stroke(to, MOP_REST_MS)]
}

function signOf(span: number): Point {
  return {
    x: MOP.fromX + (span + 0.5) * MOP.spanPx - MOP.signBack,
    y: CORRIDOR.y + MOP.signDy,
  }
}

function mopGoal(span: number, sinceMs: number): Goal {
  const at = { x: MOP.fromX + (span + 0.5) * MOP.spanPx, y: CORRIDOR.y + MOP.rowDy }

  return { kind: 'life', target: at, pose: 'idle', item: 'mop', since: sinceMs }
}

// How far through her hours the page clock stands, as a span of the corridor.
function spanAt(step: LifeStep): number {
  const window = regionPack.value.hours.crew.cleaner.find(
    ([from, to]) => step.clock.minute >= from && step.clock.minute < to
  )
  const share = window === undefined ? 0 : (step.clock.minute - window[0]) / (window[1] - window[0])

  return Math.min(MOP.spans - 1, Math.floor(share * MOP.spans))
}

// The seated receptionist nods to whoever walks through the west doorway, once per person per
// `NOD_GAP_MS`, and the guard at the gates turns to them.
function stepNods(
  state: LifeState,
  at: { crew: ReadonlyMap<ActorId, ActorState>; step: LifeStep }
): void {
  const { director, crew } = state
  const desk = at.crew.get(RECEPTIONIST)
  const guard = at.crew.get(GUARD)
  const isSeated = desk !== undefined && isIdle(state, RECEPTIONIST, desk) && isAtSeat(desk)
  const canTurn = guard !== undefined && isIdle(state, GUARD, guard) && isAtSeat(guard)

  if (guard !== undefined && crew.turnUntil > 0 && at.step.nowMs >= crew.turnUntil) {
    crew.turnUntil = 0
    director.setLife(GUARD, undefined)
  }

  for (const actor of at.step.actors.values()) {
    const id = actor.def.id
    const isDue = at.step.nowMs - (crew.nodAt.get(id) ?? Number.NEGATIVE_INFINITY) >= NOD_GAP_MS

    if (!(isDue && isCrossing(actor))) {
      continue
    }

    crew.nodAt.set(id, at.step.nowMs)

    if (isSeated) {
      director.play(RECEPTIONIST, { pose: 'nod', ms: NOD_MS })
    }

    if (canTurn) {
      crew.turnUntil = at.step.nowMs + GUARD_TURN_MS
      director.setLife(GUARD, {
        kind: 'life',
        target: SEAT_TARGET,
        pose: 'idle',
        look: actor.walker.pos,
        since: at.step.nowMs,
      })
    }
  }
}

function isCrossing(actor: ActorState): boolean {
  const { x, y } = actor.walker.pos

  return (
    WEST_DOOR !== undefined &&
    actor.floor === GROUND_FLOOR &&
    isWalking(actor.walker) &&
    x <= WEST_DOOR.at.x + WATCH_PX.depth &&
    y >= WEST_DOOR.at.y - WATCH_PX.side &&
    y <= WEST_DOOR.at.y + WEST_DOOR.width + WATCH_PX.side
  )
}

// The sign stands where the cleaner's stop puts it; each hop changes the walkers' grid once.
function syncSign(state: LifeState): void {
  const { crew } = state
  const index = crew.moments.get(CLEANER)?.index ?? 0
  const next = crew.signs[index]

  if (next?.x === crew.sign?.x && next?.y === crew.sign?.y) {
    return
  }

  crew.sign = next
  setBlock(state, 'sign', next === undefined ? undefined : wetSignRectOf(next))
}

/** The crew's next deadline: a hold under way, or the guard's turn back. */
export function crewDueOf(state: LifeState): number {
  let due = state.crew.turnUntil > 0 ? state.crew.turnUntil : Number.POSITIVE_INFINITY

  for (const moment of state.crew.moments.values()) {
    due = Math.min(due, moment.holdUntil ?? Number.POSITIVE_INFINITY)
  }

  return due
}
