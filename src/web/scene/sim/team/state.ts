import type { ReadonlySignal } from '@preact/signals'

import type { AgentWire } from '@/app/server/wire/agents'
import type { CoolerOffer } from '@/web/scene/data/team-calls'
import type { Member } from '@/web/scene/sim/team/members'
import type { ActorId, BurstView, TeamLine, TeamSay } from '@/web/scene/types'
import type { onWireEvent } from '@/web/state/events'
import type { Run } from '@/web/state/live'
import { childActorIdOf, ownActorIdOf } from '@/web/scene/sim/actors/roster'
import { agentRunOf } from '@/web/scene/sim/team/goals'
import { isAtHome } from '@/web/scene/sim/team/members'

/** How long a line on the team floor stays. */
const TEAM_LINE_MS = 6_000
// One line per speaker is kept: the desks, the children and their parents.
const MAX_TEAM_LINES = 24

export interface TeamDeps {
  readonly agents: ReadonlySignal<readonly AgentWire[]>
  readonly runs: ReadonlySignal<readonly Run[]>
  readonly offers: ReadonlySignal<CoolerOffer | undefined>
  readonly hub: typeof onWireEvent
}

/** Two agents walking to the cooler to say their calls, once both stand there. */
interface Talk {
  readonly offer: CoolerOffer
  readonly a: ActorId
  readonly b: ActorId
  isSpoken: boolean
}

/** The unfinished children a parent run has had back so far. */
export interface Tally {
  readonly partial: number
  readonly stopped: number
}

/** The team floor between steps: its people, what it heard and has yet to play. */
export interface TeamState {
  readonly deps: TeamDeps
  readonly members: Map<ActorId, Member>
  /** Agents heard as added before the roster lists them. */
  readonly arrivals: Map<string, true>
  /** Cooler talks played, by their pair of calls. */
  readonly talked: Map<string, true>
  readonly bursts: Map<string, BurstView & { readonly untilMs: number }>
  readonly tallies: Map<string, Tally>
  /** Children whose run left the feed this step; one that heard no end by the next step goes. */
  readonly missing: Set<ActorId>
  talk: Talk | undefined
  lines: readonly TeamLine[]
  lineSeq: number
  isSeeded: boolean
}

/** A line by `actor`, or by the person working `runId`; a speaker's newer line replaces its older. */
export function addLine(
  state: TeamState,
  line: { readonly actor?: ActorId; readonly runId?: string; readonly say: TeamSay },
  nowMs: number
): void {
  state.lineSeq++

  const others = state.lines.filter(
    (held) => held.actor !== line.actor || held.runId !== line.runId
  )
  const next: TeamLine = {
    ...line,
    id: `team:${state.lineSeq}`,
    atMs: nowMs,
    untilMs: nowMs + TEAM_LINE_MS,
  }

  state.lines = [...others, next].slice(-MAX_TEAM_LINES)
}

/** The own agent's person on the floor, if it has a desk. */
export function agentMemberOf(state: TeamState, agentId: string): Member | undefined {
  return state.members.get(ownActorIdOf(agentId))
}

/** The person a child works for, when it is on this floor: an own agent, or a child of a child. */
export function parentOf(
  state: TeamState,
  child: { readonly parentRunId: string; readonly parentAgentId?: string }
): Member | undefined {
  return child.parentAgentId === undefined
    ? state.members.get(childActorIdOf(child.parentRunId))
    : agentMemberOf(state, child.parentAgentId)
}

/** At home on a run under way: an agent on its own run, a child on its run until it ends. */
export function isWorking(state: TeamState, member: Member): boolean {
  if (!isAtHome(member)) {
    return false
  }

  const runs = state.deps.runs.value

  if (member.agentId !== undefined) {
    return agentRunOf(runs, member.agentId) !== undefined
  }

  const runId = member.child?.runId

  return member.outcome === undefined && runs.some((run) => run.runId === runId)
}

/** An agent at its desk with nothing under way: the only one the cooler may call over. */
export function isFree(state: TeamState, member: Member): boolean {
  const { agentId } = member
  const hasChildAtWork = [...state.members.values()].some(
    (other) => other.child !== undefined && other.child.parentAgentId === agentId
  )

  return (
    agentId !== undefined &&
    isAtHome(member) &&
    !member.isNewcomer &&
    !hasChildAtWork &&
    agentRunOf(state.deps.runs.value, agentId) === undefined
  )
}
