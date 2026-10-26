import { effect, type ReadonlySignal, untracked } from '@preact/signals'

import type { PendingWire } from '@/app/server/wire/live'
import type { ActorDef } from '@/web/scene/sim/actors/roster'
import type { WalkerState } from '@/web/scene/sim/actors/walk'
import type { Beat, BeatTarget } from '@/web/scene/sim/beats'
import type { Lift } from '@/web/scene/sim/lift'
import type { Goal } from '@/web/scene/sim/vocabulary'
import type {
  ActorId,
  ActorView,
  FloorId,
  PoseId,
  ReactionKind,
  Rect,
  SimView,
} from '@/web/scene/types'
import type { onWireEvent } from '@/web/state/events'
import type { Run } from '@/web/state/live'
import { pageMinute, pageNow } from '@/web/scene/clock/clock'
import { regionPack } from '@/web/scene/data/home'
import { actorViewsOf } from '@/web/scene/sim/actor-views'
import { ASSISTANT, CREW, ROSTER } from '@/web/scene/sim/actors/roster'
import { createWalker, isWalking, placeWalker } from '@/web/scene/sim/actors/walk'
import { endTrip, isAssistantOwed, startTrip } from '@/web/scene/sim/assistant'
import { subscribeBeats } from '@/web/scene/sim/beats'
import { enterPerson } from '@/web/scene/sim/entrance'
import { mergeMotion, SIM_STEP_MS, type StepMotion } from '@/web/scene/sim/loop'
import { createPapers, type Papers } from '@/web/scene/sim/papers'
import {
  actorsOfRun,
  createPeople,
  isLifeHeld,
  nextDueOf,
  type People,
  type Person,
  playBeat,
  resumePeople,
  setWanted,
  stampSheet,
  stepPerson,
  tickPeople,
} from '@/web/scene/sim/people'
import { isBoundForLift } from '@/web/scene/sim/places'
import { createErrands, type Errands, endErrands, isOut } from '@/web/scene/sim/street/errands'
import { goalsFor, orphansOf } from '@/web/scene/sim/vocabulary'
import { view as sceneView } from '@/web/scene/view'
import { isInRange } from '@/web/scene/world/regions'
import { seedOf } from '@/web/scene/world/rng'
import { TRAY_AT } from '@/web/scene/world/seats'
import { APPROVAL_KIND } from '@/web/state/live'
import { reducedMotion } from '@/web/state/prefs'

/** Where a person is between the office and the street: on the way out, past the street door, or
 *  on the way in. Absent while they are simply in. */
type AwayStage = 'leaving' | 'gone' | 'arriving'

/** The director's record of one person, the one the life layer and interaction read. */
export interface ActorState {
  readonly def: ActorDef
  /** The floor it stands on now, which a round can take up the lift. */
  readonly floor: FloorId
  readonly goal?: Goal
  readonly walker: WalkerState
  readonly beats: readonly Beat[]
  readonly pose: PoseId
  readonly react?: ReactionKind
  /** It stands where its goal puts it, done pushing a chair back or pausing on arrival. */
  readonly isSettled: boolean
  /** The goal it holds is the office life's, not one the live store calls for. */
  readonly isLife: boolean
  /** The assistant owes a carry or a read's trip. */
  readonly isOwed: boolean
  /** Its seat is a chair (a desk or the meeting table), not a standing place. */
  readonly hasChair: boolean
  readonly away?: AwayStage
}

interface DirectorDeps {
  readonly lift: Lift
  readonly runs: ReadonlySignal<readonly Run[]>
  readonly pending: ReadonlySignal<readonly PendingWire[]>
  readonly unread: ReadonlySignal<number>
  readonly hub: typeof onWireEvent
}

/** The people's part of the snapshot; the composer adds the floor, the light and the props. */
type PeopleView = Pick<SimView, 'actors' | 'papers' | 'tray'>

/** Each person's pose and when it began, kept from step to step. */
type PoseMarks = ReadonlyMap<ActorId, Pick<ActorView, 'pose' | 'poseSince'>>

export interface Director {
  /** The office's errands to the shops: a life goal inside, off the floor once out. */
  readonly errands: Errands
  /** Who is on the way through the street door, set by the office life; a `gone` person is not
   *  stepped or drawn. */
  readonly away: Map<ActorId, AwayStage>
  /** Back through the street door: they walk to their seat, or stand there at once. */
  enter(id: ActorId, isInstant: boolean): void
  /** One step; a walk on a floor not shown is `unseen`. */
  step(index: number): StepMotion
  view(): PeopleView
  actors(): ReadonlyMap<ActorId, ActorState>
  /** A reaction to the operator; `undefined` ends a look still held. A look lasts until it is
   *  ended and never covers a wave or a glance. */
  requestReaction(id: ActorId, kind: ReactionKind | undefined): void
  /** Where the meeting the operator called seats a person; `undefined` sends them back. */
  setMeeting(id: ActorId, goal: Goal | undefined): void
  /** The office life's goal for a person, under every goal the live store calls for; `undefined`
   *  hands them back to it (their seat when it calls for nothing). */
  setLife(id: ActorId, goal: Goal | undefined): void
  /** A gesture of the office life, played over the person's goal for `ms`. */
  play(id: ActorId, gesture: { readonly pose: PoseId; readonly ms: number }): void
  /** What stands on a floor for a while (the dessert cart): walks go round it. */
  setObstacles(floor: FloorId, rects: readonly Rect[]): void
  actorsOfRun(runId: string): readonly ActorId[]
  /** Ends every errand, re-derives every goal from the live store and ends every walk in
   *  progress: each person stands where their goal puts them. */
  resume(): void
  /** The earliest beat or wait deadline, a `performance.now()` instant; `Infinity` when none. */
  nextDueAt(): number
  dispose(): void
}

const TRAY_MAX = 8
const REACTION_MS: Readonly<Record<ReactionKind, number>> = Object.freeze({
  look: Number.POSITIVE_INFINITY,
  greet: 2_600,
  'busy-glance': 1_800,
})
const REACTION_POSES: Readonly<Record<ReactionKind, PoseId>> = Object.freeze({
  look: 'look',
  greet: 'wave',
  'busy-glance': 'busy-glance',
})
const LIFE_BEAT = 'life'

/** The one director of the office's people: real events become goals, goals become walks. One
 *  `effect` over the live store and one set of hub subscriptions; `dispose` releases both. */
export function createDirector(deps: DirectorDeps): Director {
  const papers = createPapers()
  const people = createPeople(
    [...ROSTER, ...CREW].map((def) => ({ def, walker: createWalker(def.seat.at, seedOf(def.id)) })),
    { papers, lift: deps.lift }
  )
  const stopEffect = effect(() => {
    const pending = deps.pending.value
    const goals = goalsFor(deps.runs.value, pending)
    const update = { goals, pending, orphans: orphansOf(goals, pending) }

    untracked(() => setWanted(people, update, performance.now()))
  })
  const offBeats = subscribeBeats(deps.hub, toBeatTarget(people))
  const poses: { marks: PoseMarks } = { marks: new Map() }
  const errands = createErrandsOf(people)
  const away = new Map<ActorId, AwayStage>()
  let isDisposed = false

  return {
    errands,
    step: () => (isDisposed ? 'still' : stepAll(people, { papers, poses, errands, away })),
    view: () => ({
      actors: actorViewsOf(people, { marks: poses.marks, errands, away, poseOf }),
      papers: papers.views(),
      tray: trayCount(deps, papers),
    }),
    ...lifeHooksOf(people, away),
    resume: () => {
      endErrands(errands)
      resumePeople(people, performance.now())
    },
    nextDueAt: () => nextDueOf(people, { nowMs: performance.now(), isOpen: isOfficeOpen() }),
    dispose: () => {
      if (!isDisposed) {
        isDisposed = true
        stopEffect()
        offBeats()
        papers.clear()
      }
    },
  }
}

function toBeatTarget(people: People): BeatTarget {
  return {
    actorsOfRun: (runId) => actorsOfRun(people, runId),
    deskActorOf: (requestId) =>
      people.desk.waits.get(requestId) ?? people.desk.answered.get(requestId),
    play: (actor, beat) => playBeat(people, actor, { ...beat, atMs: performance.now() }),
    sendToTray: (actor) => sendToTray(people, actor),
    stamp: (actor, action) => stampSheet(people, { actor, action }),
    startTrip: (runId, at) => {
      const ownRunId = people.wanted.get(ASSISTANT)?.runId
      const read = { runId, at, ...(ownRunId === undefined ? {} : { ownRunId }) }

      startTrip(people.walks, read, performance.now())
    },
    endTrip: (runId) => endTrip(people.walks, runId),
    pageNow,
  }
}

// Who is who, and what the scene and the office life drive through the director: reactions,
// life goals, gestures, obstacles and the way through the street door.
function lifeHooksOf(
  people: People,
  away: Map<ActorId, AwayStage>
): Pick<
  Director,
  | 'actors'
  | 'requestReaction'
  | 'setMeeting'
  | 'setLife'
  | 'play'
  | 'setObstacles'
  | 'actorsOfRun'
  | 'away'
  | 'enter'
> {
  return {
    away,
    enter: (id, isInstant) => enterPerson(people, { id, isInstant }),
    actors: () =>
      new Map(people.list.map((person) => [person.def.id, toActorState(people, person, away)])),
    requestReaction: (id, kind) => react(people, { id, kind }),
    setMeeting: (id, goal) => setGoalIn(people.meeting, id, goal),
    setLife: (id, goal) => setGoalIn(people.life, id, goal),
    play: (id, gesture) =>
      playBeat(people, id, { kind: LIFE_BEAT, ...gesture, atMs: performance.now() }),
    setObstacles: (floor, rects) => {
      people.obstacles.set(floor, rects)
    },
    actorsOfRun: (runId) => actorsOfRun(people, runId),
  }
}

// The errands drive the people's life goals and walkers, and put someone back at their seat.
function createErrandsOf(people: People): Errands {
  return createErrands({
    setLife: (id, goal) => setGoalIn(people.life, id, goal),
    walkerOf: (id) => people.byId.get(id)?.walker,
    placeAtSeat: (id) => {
      const person = people.byId.get(id)

      if (person !== undefined) {
        placeWalker(person.walker, person.def.seat.at)
      }
    },
  })
}

function setGoalIn(layer: Map<ActorId, Goal>, id: ActorId, goal: Goal | undefined): void {
  if (goal === undefined) {
    layer.delete(id)
  } else {
    layer.set(id, goal)
  }
}

function react(
  people: People,
  ask: { readonly id: ActorId; readonly kind: ReactionKind | undefined }
): void {
  const person = people.byId.get(ask.id)
  const held = person?.react?.kind

  if (person === undefined || (ask.kind === 'look' && held !== undefined && held !== 'look')) {
    return
  }

  if (ask.kind === undefined) {
    person.react = held === 'look' ? undefined : person.react
    return
  }

  person.react = { kind: ask.kind, untilMs: performance.now() + REACTION_MS[ask.kind] }
}

// Every person's walk among the others on their floor, the sheets in flight, then the poses.
// Someone out on an errand or gone home is off the floor, in no one's way.
function stepAll(
  people: People,
  held: {
    readonly papers: Papers
    readonly poses: { marks: PoseMarks }
    readonly errands: Errands
    readonly away: ReadonlyMap<ActorId, AwayStage>
  }
): StepMotion {
  const { papers, poses, errands, away } = held
  const nowMs = performance.now()
  const shownFloor = sceneView.peek().floor
  const isChanged = tickPeople(people, { nowMs, isOpen: isOfficeOpen() })
  const isHidden = (id: ActorId): boolean =>
    isOut(errands, id) || away.get(id) === 'gone' || people.byId.get(id)?.isRiding === true
  let motion: StepMotion = 'still'

  for (const person of people.list) {
    if (isHidden(person.def.id)) {
      continue
    }

    const others = people.list
      .filter(
        (other) => other !== person && other.floor === person.floor && !isHidden(other.def.id)
      )
      .map((other) => other.walker)

    const extra = people.obstacles.get(person.floor)
    const step = { nowMs, dtMs: SIM_STEP_MS, ...(extra === undefined ? {} : { extra }) }

    if (stepPerson(person, others, step)) {
      motion = mergeMotion(motion, person.floor === shownFloor ? 'seen' : 'unseen')
    }
  }

  const settled = settlePoses(people.list, { marks: poses.marks, nowMs })

  poses.marks = settled.marks

  return papers.step(nowMs) || isChanged || settled.isChanged ? 'seen' : motion
}

/** Office hours by the page clock and the home region's pack. */
export function isOfficeOpen(): boolean {
  return isInRange(pageMinute.value.minute, regionPack.value.officeHours)
}

function sendToTray(people: People, actor: ActorId): void {
  const person = people.byId.get(actor)

  if (person !== undefined && !reducedMotion.value) {
    people.papers.launch(
      { floor: person.floor, from: person.walker.pos, to: TRAY_AT },
      performance.now()
    )
  }
}

// One sheet per waiting approval and unread notice, less the ones still flying in; reading the
// bell empties it.
function trayCount(deps: DirectorDeps, papers: Papers): number {
  const approvals = deps.pending.value.filter((entry) => entry.kind === APPROVAL_KIND).length
  const stacked = Math.min(TRAY_MAX, approvals + deps.unread.value)

  return Math.max(0, stacked - papers.flyingToTray())
}

function toActorState(
  people: People,
  person: Person,
  away: ReadonlyMap<ActorId, AwayStage>
): ActorState {
  const isAssistant = person.def.id === ASSISTANT
  const stage = away.get(person.def.id)

  return {
    def: person.def,
    floor: person.floor,
    walker: person.walker,
    beats: person.beats,
    pose: poseOf(person),
    isSettled: person.phase === 'still' && !person.isRiding && !isBoundForLift(person),
    isLife: isLifeHeld(people, person),
    isOwed: isAssistant && isAssistantOwed(people.walks, people.orphans),
    hasChair: person.hasChair,
    ...(person.goal === undefined ? {} : { goal: person.goal }),
    ...(person.react === undefined ? {} : { react: person.react.kind }),
    ...(stage === undefined ? {} : { away: stage }),
  }
}

// A pose that changes starts its frames from this step and asks for one frame to show it.
function settlePoses(
  list: readonly Person[],
  at: { readonly marks: PoseMarks; readonly nowMs: number }
): { readonly marks: PoseMarks; readonly isChanged: boolean } {
  let isChanged = false
  const marks = new Map(
    list.map((person) => {
      const pose = poseOf(person)
      const held = at.marks.get(person.def.id)

      if (held?.pose === pose) {
        return [person.def.id, held] as const
      }

      isChanged = true

      return [person.def.id, { pose, poseSince: at.nowMs }] as const
    })
  )

  return { marks, isChanged }
}

// A beat plays over everything; walking reads as a walk; a reaction to the operator over the
// goal's pose at rest, else seated at a desk or standing.
function poseOf(person: Person): PoseId {
  const beat = person.beats.at(-1)

  if (beat !== undefined) {
    return beat.pose
  }

  if (isWalking(person.walker) || person.phase === 'rising') {
    return 'walk'
  }

  if (person.react !== undefined) {
    return REACTION_POSES[person.react.kind]
  }

  if (person.goal !== undefined && person.phase === 'still') {
    return person.goal.pose
  }

  return person.def.seat.desk === true ? 'sit' : 'idle'
}
