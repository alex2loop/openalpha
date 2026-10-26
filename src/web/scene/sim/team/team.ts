import type { ActorView, TeamView } from '@/web/scene/types'
import { SIM_STEP_MS } from '@/web/scene/sim/loop'
import { arriveAtCooler, closeTalk, tryTalk } from '@/web/scene/sim/team/cooler'
import { listenTeam } from '@/web/scene/sim/team/events'
import { type Member, settlePose, stepMember, toTeamActorView } from '@/web/scene/sim/team/members'
import { syncMembers } from '@/web/scene/sim/team/roster-sync'
import { isWorking, type TeamDeps, type TeamState } from '@/web/scene/sim/team/state'
import { finishTasks } from '@/web/scene/sim/team/tasks'
import { buildTeamView } from '@/web/scene/sim/team/view'

/** The team floor's people and what they show, stepped by the scene's one loop. */
export interface Team {
  step(nowMs: number): boolean
  actors(): readonly ActorView[]
  view(nowMs: number): TeamView
  /** Everyone stands where their task puts them, at once: a resume after a hidden spell. */
  resume(): void
  nextDueAt(nowMs: number): number
  dispose(): void
}

/** The own agents at their desks, a new hire, the cooler talk and spawned children: one set of
 *  hub subscriptions, released with every person by `dispose`. */
export function createTeam(deps: TeamDeps): Team {
  const state: TeamState = {
    deps,
    members: new Map(),
    arrivals: new Map(),
    talked: new Map(),
    bursts: new Map(),
    tallies: new Map(),
    missing: new Set(),
    talk: undefined,
    lines: [],
    lineSeq: 0,
    isSeeded: false,
  }
  const off = listenTeam(state)
  let isDisposed = false

  return {
    step: (nowMs) => !isDisposed && stepTeam(state, nowMs),
    actors: () => [...state.members.values()].map((member) => toView(state, member)),
    view: (nowMs) => buildTeamView(state, nowMs),
    resume: () => syncMembers(state, { nowMs: performance.now(), isResume: true }),
    nextDueAt: (nowMs) => nextDueOf(state, nowMs),
    dispose: () => {
      if (!isDisposed) {
        isDisposed = true
        off()
        state.members.clear()
        state.lines = []
        state.talk = undefined
      }
    },
  }
}

// The roster and the runs first, then every walk, the tasks that end, the cooler, the poses.
function stepTeam(state: TeamState, nowMs: number): boolean {
  let isChanged = syncMembers(state, { nowMs, isResume: false })
  const list = [...state.members.values()]

  for (const member of list) {
    const others = list.filter((other) => other !== member).map((other) => other.walker)
    const moved = stepMember(member, others, SIM_STEP_MS)

    isChanged = moved !== 'still' || isChanged
  }

  isChanged = finishTasks(state, nowMs) || isChanged
  tryTalk(state, state.deps.offers.value)
  arriveAtCooler(state, nowMs)
  closeTalk(state)

  for (const member of state.members.values()) {
    isChanged = settlePose(member, { isWorking: isWorking(state, member), nowMs }) || isChanged
  }

  return isChanged
}

function toView(state: TeamState, member: Member): ActorView {
  const faceAt = member.face === undefined ? undefined : state.members.get(member.face)

  return toTeamActorView(member, {
    isWorking: isWorking(state, member),
    faceAt: faceAt?.walker.pos,
  })
}

// A timed task ending, a line or burst ending, or a child whose run left the feed unheard.
function nextDueOf(state: TeamState, nowMs: number): number {
  const dues = [
    ...[...state.members.values()].map((member) => member.taskUntil),
    ...state.lines.map((line) => line.untilMs),
    ...[...state.bursts.values()].map((burst) => burst.untilMs),
    state.missing.size > 0 ? nowMs + SIM_STEP_MS : Number.POSITIVE_INFINITY,
  ]

  return Math.min(...dues.filter((due) => due > nowMs), Number.POSITIVE_INFINITY)
}
