import type { AgentLookWire } from '@/app/server/wire/agents'
import type { ActorId, ActorView, Dir, Point, PoseId } from '@/web/scene/types'
import type { Seat } from '@/web/scene/world/seats'
import {
  createWalker,
  isWalking,
  placeWalker,
  startWalk,
  stepWalk,
  type WalkerState,
} from '@/web/scene/sim/actors/walk'
import { toDir } from '@/web/scene/sim/places'
import { TEAM_FLOOR } from '@/web/scene/world/floors'
import { navGridOf } from '@/web/scene/world/nav-grid'
import { seedOf } from '@/web/scene/world/rng'
import { reducedMotion } from '@/web/state/prefs'

// A child wears no prop of its own: the plain look.
const PLAIN_LOOK: AgentLookWire = Object.freeze({ prop: 'none' })

/** What a person on the team floor is doing: at home (its seat), waving in from the lift, at the
 *  cooler, carrying a child's answer back, or walking out to the lift. */
type Task = 'home' | 'wave' | 'cooler' | 'carry' | 'exit'

/** A child's run, and the run and own agent it works for. */
interface ChildOf {
  readonly runId: string
  readonly parentRunId: string
  readonly role: string
  readonly parentAgentId?: string
}

/** One person of the team floor: an own agent at its desk, or a temporary child. `dest` is where
 *  its task puts it, `taskUntil` (a `performance.now()` instant) when a timed task ends. */
export interface Member {
  readonly id: ActorId
  readonly walker: WalkerState
  readonly agentId?: string
  readonly child?: ChildOf
  readonly slot?: number
  readonly seat: Seat
  look: AgentLookWire | undefined
  task: Task
  dest: Point
  isArrived: boolean
  taskUntil: number
  face: ActorId | undefined
  isNewcomer: boolean
  outcome: string | undefined
  pose: PoseId
  poseSince: number
}

interface MemberSpec {
  readonly id: ActorId
  readonly at: Point
  readonly seat: Seat
  readonly slot?: number
  readonly agentId?: string
  readonly child?: ChildOf
  readonly look?: AgentLookWire
}

export function createMember(spec: MemberSpec): Member {
  const { at, seat, slot, agentId, child } = spec

  return {
    id: spec.id,
    walker: createWalker(at, seedOf(spec.id)),
    ...(agentId === undefined ? {} : { agentId }),
    ...(child === undefined ? {} : { child }),
    ...(slot === undefined ? {} : { slot }),
    seat,
    look: child === undefined ? spec.look : PLAIN_LOOK,
    task: 'home',
    dest: at,
    isArrived: true,
    taskUntil: Number.POSITIVE_INFINITY,
    face: undefined,
    isNewcomer: false,
    outcome: undefined,
    pose: 'idle',
    poseSince: 0,
  }
}

/** Gives the person a task at `dest` and starts the walk there; reduced motion, or a place no
 *  route reaches, puts them there at once. */
export function sendTo(member: Member, task: Task, dest: Point): void {
  member.task = task
  member.dest = dest
  member.isArrived = false
  member.taskUntil = Number.POSITIVE_INFINITY

  if (reducedMotion.value || !startWalk(member.walker, navGridOf(TEAM_FLOOR), dest)) {
    placeWalker(member.walker, dest)
  }
}

/** One sim step of the person's walk among `others`; `arrived` once, the step they get there. */
export function stepMember(
  member: Member,
  others: readonly WalkerState[],
  dtMs: number
): 'moving' | 'arrived' | 'still' {
  if (isWalking(member.walker)) {
    stepWalk(member.walker, others, dtMs)

    return 'moving'
  }

  member.walker.prev = member.walker.pos

  if (member.isArrived) {
    return 'still'
  }

  member.isArrived = true

  return 'arrived'
}

/** The pose the person's task shows; a pose that changes starts its frames now. True on a change. */
export function settlePose(member: Member, at: { isWorking: boolean; nowMs: number }): boolean {
  const pose = poseOf(member, at.isWorking)

  if (pose === member.pose) {
    return false
  }

  member.pose = pose
  member.poseSince = at.nowMs

  return true
}

export function toTeamActorView(
  member: Member,
  at: { readonly isWorking: boolean; readonly faceAt: Point | undefined }
): ActorView {
  return {
    id: member.id,
    floor: TEAM_FLOOR,
    prev: member.walker.prev,
    at: member.walker.pos,
    facing: facingOf(member, at.faceAt),
    working: at.isWorking,
    pose: member.pose,
    poseSince: member.poseSince,
    ...(member.look === undefined ? {} : { look: member.look }),
    ...(member.task === 'carry' ? { sheet: {} } : {}),
  }
}

/** Seated at home, not walking: where a person works on a run or may be asked to the cooler. */
export function isAtHome(member: Member): boolean {
  return member.task === 'home' && member.isArrived && !isWalking(member.walker)
}

function poseOf(member: Member, isWorking: boolean): PoseId {
  if (isWalking(member.walker)) {
    return 'walk'
  }

  switch (member.task) {
    case 'wave':
      return 'wave'
    case 'cooler':
      return 'chat'
    case 'carry':
      return 'hand'
    case 'exit':
      return 'idle'
    case 'home':
      return homePoseOf(member, isWorking)
    default:
      return member.task satisfies never
  }
}

function homePoseOf(member: Member, isWorking: boolean): PoseId {
  if (isWorking) {
    return 'type'
  }

  return member.seat.desk === true ? 'sit' : 'idle'
}

// Where they walk, else at whoever they talk to or hand over to, else their seat's way.
function facingOf(member: Member, faceAt: Point | undefined): Dir {
  const { pos, prev } = member.walker

  if (pos.x !== prev.x || pos.y !== prev.y) {
    return toDir(pos.x - prev.x, pos.y - prev.y)
  }

  if (faceAt !== undefined && member.task !== 'home') {
    return toDir(faceAt.x - pos.x, faceAt.y - pos.y)
  }

  return member.task === 'home' ? member.seat.face : 'down'
}
