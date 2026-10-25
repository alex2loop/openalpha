import type { PendingWire } from '@/app/server/wire/live'
import type { ActorDef } from '@/web/scene/sim/actors/roster'
import type { Beat } from '@/web/scene/sim/beats'
import type { Papers } from '@/web/scene/sim/papers'
import type { Goal } from '@/web/scene/sim/vocabulary'
import type { ActorId, ActorView, Point, SheetView } from '@/web/scene/types'
import type { PropKind } from '@/web/scene/world/props'
import { distance } from '@/web/scene/sim/actors/nav'
import {
  isWalking,
  placeWalker,
  startWalk,
  stepWalk,
  type WalkerState,
} from '@/web/scene/sim/actors/walk'
import {
  catchUpDesk,
  createDesk,
  type Desk,
  deskDues,
  isDeskDue,
  syncDesk,
} from '@/web/scene/sim/desk'
import { destOf, facingOf } from '@/web/scene/sim/places'
import { setCapped } from '@/web/scene/world/capped-map'
import { navGridOf } from '@/web/scene/world/nav-grid'
import { propsOn } from '@/web/scene/world/props'
import { isInside } from '@/web/scene/world/rooms'
import { reducedMotion } from '@/web/state/prefs'

/** A greeting or a look a person gives the operator; it ends by itself. */
export type ReactionKind = 'look' | 'wave'

type Phase = 'still' | 'rising' | 'walking' | 'settling'

/** One person as the director moves them: the goal they hold, where it puts them (`dest`), and
 *  the phase of getting there (push the chair back, walk, pause on arrival). */
export interface Person {
  readonly def: ActorDef
  readonly walker: WalkerState
  readonly hasChair: boolean
  goal: Goal | undefined
  dest: Point
  phase: Phase
  phaseUntil: number
  beats: readonly Beat[]
  react: { readonly kind: ReactionKind; readonly untilMs: number } | undefined
  stamp: SheetView['action']
}

/** The assistant's read under way: once it has run `TRIP_AFTER_MS` it walks to the prop. */
interface Trip {
  readonly runId: string
  readonly at: PropKind
  readonly dueAt: number
}

/** One gesture to play now for `ms`. */
interface BeatPlay {
  readonly kind: Beat['kind']
  readonly pose: Beat['pose']
  readonly item?: Beat['item']
  readonly ms: number
}

/** Everyone the director moves, and what their goals wait on. */
export interface People {
  readonly list: readonly Person[]
  readonly byId: ReadonlyMap<ActorId, Person>
  readonly papers: Papers
  readonly desk: Desk
  readonly stages: Map<string, { readonly stage: string; readonly actors: readonly ActorId[] }>
  readonly runActors: Map<string, readonly ActorId[]>
  wanted: ReadonlyMap<ActorId, Goal>
  trip: Trip | undefined
}

const TRIP_AFTER_MS = 5_000
const FOOT_TAP_MS = 1_200
const MAX_BEATS_PER_ACTOR = 4
const CHAIR_PUSH_MS = 400
const ARRIVE_PAUSE_MS = 500
// Runs remembered past their end, for the beats their last events play.
const MAX_RUN_MEMORY = 32
// Under this a person still sits on their own chair.
const SEATED_PX = 1
const SEAT_TARGET = 'seat'
const ASSISTANT: ActorId = 'assistant'

export function createPeople(
  seeds: readonly { readonly def: ActorDef; readonly walker: WalkerState }[],
  papers: Papers
): People {
  const list = seeds.map(toPerson)

  return {
    list,
    byId: new Map(list.map((person) => [person.def.id, person])),
    papers,
    desk: createDesk(),
    stages: new Map(),
    runActors: new Map(),
    wanted: new Map(),
    trip: undefined,
  }
}

function toPerson(seed: { readonly def: ActorDef; readonly walker: WalkerState }): Person {
  const seat = seed.def.seat.at
  const hasChair = propsOn(seed.def.floor).some(
    (prop) => prop.kind === 'chair' && isInside(prop.rect, seat)
  )

  return {
    ...seed,
    hasChair,
    goal: undefined,
    dest: seat,
    phase: 'still',
    phaseUntil: 0,
    beats: [],
    react: undefined,
    stamp: undefined,
  }
}

/** Takes the goals the live store calls for: desk waits start their clocks, a stage change hands
 *  sheets on, and everyone retargets. */
export function setWanted(
  people: People,
  update: { readonly goals: ReadonlyMap<ActorId, Goal>; readonly pending: readonly PendingWire[] },
  nowMs: number
): void {
  people.wanted = update.goals
  syncDesk(people.desk, update, nowMs)
  handOff(people, nowMs)
  applyGoals(people, nowMs)
}

/** Ends beats and looks that are over, taps a waiting foot once, and applies goals whose wait
 *  (the desk delay, a trip) has run out. True when anything changed. */
export function tickPeople(people: People, nowMs: number): boolean {
  let isChanged = false

  for (const person of people.list) {
    const beats = person.beats.filter((beat) => beat.untilMs > nowMs)
    const isReactOver = person.react !== undefined && person.react.untilMs <= nowMs

    isChanged = isChanged || isReactOver || beats.length !== person.beats.length
    person.beats = beats
    person.react = isReactOver ? undefined : person.react
  }

  const isTapped = tapFeet(people, nowMs)
  const isRetargeted = applyGoals(people, nowMs)

  return isChanged || isTapped || isRetargeted
}

/** One sim step of one person's walk among `others`; true while it moves or its phase changed. */
export function stepPerson(
  person: Person,
  others: readonly WalkerState[],
  step: { readonly nowMs: number; readonly dtMs: number }
): boolean {
  if (person.phase === 'walking') {
    if (stepWalk(person.walker, others, step.dtMs) === 'arrived') {
      person.phase = 'settling'
      person.phaseUntil = step.nowMs + ARRIVE_PAUSE_MS
    }

    return true
  }

  person.walker.prev = person.walker.pos

  if (person.phase === 'still' || step.nowMs < person.phaseUntil) {
    return false
  }

  if (person.phase === 'rising') {
    beginWalk(person)
  } else {
    person.phase = 'still'
  }

  return true
}

export function playBeat(people: People, actor: ActorId, beat: BeatPlay): void {
  const person = people.byId.get(actor)

  if (person === undefined) {
    return
  }

  const played: Beat = {
    kind: beat.kind,
    pose: beat.pose,
    untilMs: performance.now() + beat.ms,
    ...(beat.item === undefined ? {} : { item: beat.item }),
  }

  person.beats = [...person.beats, played].slice(-MAX_BEATS_PER_ACTOR)
}

/** The people a run moves now, else the ones it moved last. */
export function actorsOfRun(people: People, runId: string): readonly ActorId[] {
  const now = [...people.wanted].filter(([, goal]) => goal.runId === runId).map(([id]) => id)

  return now.length > 0 ? now : (people.runActors.get(runId) ?? [])
}

/** The stamp lands on the sheet `actor` carries to the results board, not one held at your desk. */
export function stampSheet(
  people: People,
  stamp: { readonly actor: ActorId; readonly action: NonNullable<SheetView['action']> }
): void {
  const person = people.byId.get(stamp.actor)

  if (person?.goal?.hasSheet === true && person.goal.requestId === undefined) {
    person.stamp = stamp.action
  }
}

/** A read in the assistant's run: a trip once it has run `TRIP_AFTER_MS`. */
export function startTrip(
  people: People,
  read: { readonly runId: string; readonly at: PropKind }
): void {
  if (people.wanted.get(ASSISTANT)?.runId === read.runId) {
    people.trip = { ...read, dueAt: performance.now() + TRIP_AFTER_MS }
  }
}

/** The read ended: a trip not yet begun never begins, one under way turns back. */
export function endTrip(people: People, runId: string): void {
  if (people.trip?.runId === runId) {
    people.trip = undefined
    applyGoals(people, performance.now())
  }
}

/** Everyone stands where their goal puts them, at once: no walk, beat, sheet in flight or trip
 *  carries over. */
export function resumePeople(people: People, nowMs: number): void {
  people.trip = undefined
  people.papers.clear()
  catchUpDesk(people.desk, nowMs)

  for (const person of people.list) {
    person.goal = effectiveGoal(people, person.def.id, nowMs)
    person.dest = destOf(person, people.list)
    person.phase = 'still'
    person.beats = []
    person.react = undefined
    placeWalker(person.walker, person.dest)
  }
}

/** The earliest moment something is due: a phase, beat or look ending, a desk walk, a foot tap,
 *  a trip. */
export function nextDueOf(people: People, nowMs: number): number {
  const dues = [...deskDues(people.desk), people.trip?.dueAt ?? Number.POSITIVE_INFINITY]

  for (const person of people.list) {
    const isWaiting = person.phase === 'rising' || person.phase === 'settling'

    dues.push(
      isWaiting ? person.phaseUntil : Number.POSITIVE_INFINITY,
      person.react?.untilMs ?? Number.POSITIVE_INFINITY,
      ...person.beats.map((beat) => beat.untilMs)
    )
  }

  return Math.min(...dues.filter((due) => due > nowMs), Number.POSITIVE_INFINITY)
}

export function toActorView(people: People, person: Person): ActorView {
  const item = person.beats.at(-1)?.item ?? person.goal?.item
  const sheet = person.goal?.hasSheet === true ? toSheet(person) : undefined

  return {
    id: person.def.id,
    role: person.def.role,
    floor: person.def.floor,
    prev: person.walker.prev,
    at: person.walker.pos,
    facing: facingOf(person, people.byId),
    working: isWorking(person),
    ...(item === undefined ? {} : { item }),
    ...(sheet === undefined ? {} : { sheet }),
  }
}

/** Typing, a lit desk and a scrolling screen exist only for a `work` goal with its run, once the
 *  person stands where the goal puts them. */
function isWorking(person: Person): boolean {
  return person.goal?.kind === 'work' && person.goal.runId !== undefined && person.phase === 'still'
}

function toSheet(person: Person): SheetView {
  return person.stamp === undefined ? {} : { action: person.stamp }
}

function tapFeet(people: People, nowMs: number): boolean {
  let isTapped = false

  for (const [requestId, wait] of people.desk.waits) {
    const person = people.byId.get(wait.actor)
    const isThere = person?.goal?.requestId === requestId && person.phase === 'still'

    if (!wait.isTapped && nowMs >= wait.tapAt && isThere) {
      wait.isTapped = true
      playBeat(people, wait.actor, { kind: 'foot-tap', pose: 'foot-tap', ms: FOOT_TAP_MS })
      isTapped = true
    }
  }

  return isTapped
}

// At each stage change of a run, a sheet goes from the people who finished to the people who
// start: one to one, round the shorter list.
function handOff(people: People, nowMs: number): void {
  const byRun = new Map<string, { stage?: string; actors: ActorId[] }>()

  for (const [actor, goal] of people.wanted) {
    if (goal.runId !== undefined) {
      const held = byRun.get(goal.runId) ?? { actors: [] }

      held.actors.push(actor)
      byRun.set(goal.runId, { ...held, ...(goal.stage === undefined ? {} : { stage: goal.stage }) })
    }
  }

  for (const [runId, current] of byRun) {
    const before = people.stages.get(runId)
    const isNewStage =
      before !== undefined && current.stage !== undefined && before.stage !== current.stage

    if (isNewStage) {
      flyBetween(people, { from: before.actors, to: current.actors }, nowMs)
    }

    setCapped(people.runActors, [runId, current.actors], MAX_RUN_MEMORY)
  }

  people.stages.clear()

  for (const [runId, current] of byRun) {
    if (current.stage !== undefined) {
      people.stages.set(runId, { stage: current.stage, actors: current.actors })
    }
  }
}

function flyBetween(
  people: People,
  pair: { readonly from: readonly ActorId[]; readonly to: readonly ActorId[] },
  nowMs: number
): void {
  const count = reducedMotion.value ? 0 : Math.max(pair.from.length, pair.to.length)

  for (let i = 0; i < count; i++) {
    const fromId = pair.from[i % pair.from.length]
    const toId = pair.to[i % pair.to.length]
    const from = fromId === undefined ? undefined : people.byId.get(fromId)
    const to = toId === undefined ? undefined : people.byId.get(toId)

    if (from !== undefined && to !== undefined && from !== to && from.def.floor === to.def.floor) {
      people.papers.launch(
        { floor: from.def.floor, from: from.walker.pos, to: to.walker.pos },
        nowMs
      )
    }
  }
}

function applyGoals(people: People, nowMs: number): boolean {
  let isChanged = false

  for (const person of people.list) {
    const goal = effectiveGoal(people, person.def.id, nowMs)

    if (!isSameGoal(goal, person.goal)) {
      retarget(people, person, { goal, nowMs })
      isChanged = true
    }
  }

  return isChanged
}

// A desk walk waits `DESK_WALK_AFTER_MS` (the hand goes up at the seat meanwhile); the assistant's
// read becomes a trip once it is due.
function effectiveGoal(people: People, id: ActorId, nowMs: number): Goal | undefined {
  const goal = people.wanted.get(id)

  if (goal?.requestId !== undefined) {
    return isDeskDue(people.desk.waits.get(goal.requestId), nowMs)
      ? goal
      : { ...goal, target: SEAT_TARGET }
  }

  const trip = people.trip
  const isTripDue = trip !== undefined && trip.runId === goal?.runId && nowMs >= trip.dueAt

  return id === ASSISTANT && goal !== undefined && isTripDue
    ? { ...goal, target: trip.at, pose: 'reach' }
    : goal
}

function isSameGoal(a: Goal | undefined, b: Goal | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b
  }

  return (
    a.kind === b.kind &&
    a.runId === b.runId &&
    a.pose === b.pose &&
    a.stage === b.stage &&
    a.requestId === b.requestId &&
    a.face === b.face &&
    a.item === b.item &&
    targetKeyOf(a) === targetKeyOf(b)
  )
}

function targetKeyOf(goal: Goal): string {
  return typeof goal.target === 'string' ? goal.target : `${goal.target.x},${goal.target.y}`
}

function retarget(
  people: People,
  person: Person,
  next: { readonly goal: Goal | undefined; readonly nowMs: number }
): void {
  person.goal = next.goal
  person.stamp = next.goal?.hasSheet === true ? person.stamp : undefined

  const dest = destOf(person, people.list)

  if (dest.x === person.dest.x && dest.y === person.dest.y) {
    return
  }

  person.dest = dest
  moveTo(person, next.nowMs)
}

// Walking already: turn toward the new place at once. Seated: push the chair back first.
function moveTo(person: Person, nowMs: number): void {
  if (reducedMotion.value) {
    placeWalker(person.walker, person.dest)
    person.phase = 'still'
    return
  }

  const isSeated = person.hasChair && distance(person.walker.pos, person.def.seat.at) < SEATED_PX

  if (!isWalking(person.walker) && isSeated) {
    person.phase = 'rising'
    person.phaseUntil = nowMs + CHAIR_PUSH_MS
    return
  }

  beginWalk(person)
}

function beginWalk(person: Person): void {
  const isStarted = startWalk(person.walker, navGridOf(person.def.floor), person.dest)

  person.phase = isStarted ? 'walking' : 'still'
}
