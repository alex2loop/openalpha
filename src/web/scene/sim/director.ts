import { effect, type ReadonlySignal, untracked } from '@preact/signals'

import type { PendingWire } from '@/app/server/wire/live'
import type { PoseId } from '@/web/scene/sim/actors/poses'
import type { ActorDef } from '@/web/scene/sim/actors/roster'
import type { WalkerState } from '@/web/scene/sim/actors/walk'
import type { Beat, BeatTarget } from '@/web/scene/sim/beats'
import type { Goal } from '@/web/scene/sim/vocabulary'
import type { ActorId, SimView } from '@/web/scene/types'
import type { onWireEvent } from '@/web/state/events'
import type { Run } from '@/web/state/live'
import { pageNow } from '@/web/scene/clock/clock'
import { ROSTER } from '@/web/scene/sim/actors/roster'
import { createWalker, isWalking } from '@/web/scene/sim/actors/walk'
import { subscribeBeats } from '@/web/scene/sim/beats'
import { SIM_STEP_MS } from '@/web/scene/sim/loop'
import { createPapers, type Papers } from '@/web/scene/sim/papers'
import {
  actorsOfRun,
  createPeople,
  endTrip,
  nextDueOf,
  type People,
  type Person,
  playBeat,
  type ReactionKind,
  resumePeople,
  setWanted,
  stampSheet,
  startTrip,
  stepPerson,
  tickPeople,
  toActorView,
} from '@/web/scene/sim/people'
import { goalsFor } from '@/web/scene/sim/vocabulary'
import { seedOf } from '@/web/scene/world/rng'
import { TRAY_AT } from '@/web/scene/world/seats'
import { reducedMotion } from '@/web/state/prefs'

/** The director's record of one person, the one the life layer and interaction read. */
export interface ActorState {
  readonly def: ActorDef
  readonly goal?: Goal
  readonly walker: WalkerState
  readonly beats: readonly Beat[]
  readonly pose: PoseId
  readonly react?: ReactionKind
}

interface DirectorDeps {
  readonly runs: ReadonlySignal<readonly Run[]>
  readonly pending: ReadonlySignal<readonly PendingWire[]>
  readonly unread: ReadonlySignal<number>
  readonly hub: typeof onWireEvent
}

/** The people's part of the snapshot; the composer adds the floor, the light and the props. */
type PeopleView = Pick<SimView, 'actors' | 'papers' | 'tray'>

export interface Director {
  step(index: number): boolean
  view(): PeopleView
  actors(): ReadonlyMap<ActorId, ActorState>
  requestReaction(id: ActorId, kind: ReactionKind): void
  /** Re-derives every goal from the live store and ends every walk in progress: each person
   *  stands where their goal puts them. */
  resume(): void
  /** The earliest beat or wait deadline, a `performance.now()` instant; `Infinity` when none. */
  nextDueAt(): number
  dispose(): void
}

const TRAY_MAX = 8
const REACTION_MS = 1_800
const BUSY_DESK_ROLE = 'approval'

/** The one director of the office's people: real events become goals, goals become walks. One
 *  `effect` over the live store and one set of hub subscriptions; `dispose` releases both. */
export function createDirector(deps: DirectorDeps): Director {
  const papers = createPapers()
  const people = createPeople(
    ROSTER.map((def) => ({ def, walker: createWalker(def.seat.at, seedOf(def.id)) })),
    papers
  )
  const stopEffect = effect(() => {
    const update = {
      goals: goalsFor(deps.runs.value, deps.pending.value),
      pending: deps.pending.value,
    }

    untracked(() => setWanted(people, update, performance.now()))
  })
  const offBeats = subscribeBeats(deps.hub, toBeatTarget(people))
  let isDisposed = false

  return {
    step: () => !isDisposed && stepAll(people, papers),
    view: () => ({
      actors: people.list.map((person) => toActorView(people, person)),
      papers: papers.views(),
      tray: trayCount(deps, papers),
    }),
    actors: () => new Map(people.list.map((person) => [person.def.id, toActorState(person)])),
    requestReaction: (id, kind) => react(people, { id, kind }),
    resume: () => resumePeople(people, performance.now()),
    nextDueAt: () => nextDueOf(people, performance.now()),
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
    play: (actor, beat) => playBeat(people, actor, beat),
    sendToTray: (actor) => sendToTray(people, actor),
    stamp: (actor, action) => stampSheet(people, { actor, action }),
    startTrip: (runId, at) => startTrip(people, { runId, at }),
    endTrip: (runId) => endTrip(people, runId),
    pageNow,
  }
}

function react(people: People, ask: { readonly id: ActorId; readonly kind: ReactionKind }): void {
  const person = people.byId.get(ask.id)

  if (person !== undefined) {
    person.react = { kind: ask.kind, untilMs: performance.now() + REACTION_MS }
  }
}

// Every person's walk among the others on their floor, then the sheets in flight.
function stepAll(people: People, papers: Papers): boolean {
  const nowMs = performance.now()
  const isChanged = tickPeople(people, nowMs)
  let isMoving = false

  for (const person of people.list) {
    const others = people.list
      .filter((other) => other !== person && other.def.floor === person.def.floor)
      .map((other) => other.walker)

    isMoving = stepPerson(person, others, { nowMs, dtMs: SIM_STEP_MS }) || isMoving
  }

  return papers.step(nowMs) || isMoving || isChanged
}

function sendToTray(people: People, actor: ActorId): void {
  const person = people.byId.get(actor)

  if (person !== undefined && !reducedMotion.value) {
    people.papers.launch(
      { floor: person.def.floor, from: person.walker.pos, to: TRAY_AT },
      performance.now()
    )
  }
}

// One sheet per waiting approval and unread notice, less the ones still flying in; reading the
// bell empties it.
function trayCount(deps: DirectorDeps, papers: Papers): number {
  const approvals = deps.pending.value.filter((entry) => entry.kind === BUSY_DESK_ROLE).length
  const stacked = Math.min(TRAY_MAX, approvals + deps.unread.value)

  return Math.max(0, stacked - papers.flyingToTray())
}

function toActorState(person: Person): ActorState {
  return {
    def: person.def,
    walker: person.walker,
    beats: person.beats,
    pose: poseOf(person),
    ...(person.goal === undefined ? {} : { goal: person.goal }),
    ...(person.react === undefined ? {} : { react: person.react.kind }),
  }
}

// A beat plays over everything; walking reads as a walk; at rest the goal's pose, else seated at
// a desk or standing.
function poseOf(person: Person): PoseId {
  const beat = person.beats.at(-1)

  if (beat !== undefined) {
    return beat.pose
  }

  if (isWalking(person.walker) || person.phase === 'rising') {
    return 'walk'
  }

  if (person.goal !== undefined && person.phase === 'still') {
    return person.goal.pose
  }

  return person.def.seat.desk === true ? 'sit' : 'idle'
}
