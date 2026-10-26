import type { AgentWire } from '@/app/server/wire/agents'
import type { Run } from '@/web/state/live'
import { childActorIdOf, ownActorIdOf } from '@/web/scene/sim/actors/roster'
import { placeWalker } from '@/web/scene/sim/actors/walk'
import { childEntryOf, childPlaceOf } from '@/web/scene/sim/team/children'
import { startArrival } from '@/web/scene/sim/team/events'
import { childRoleOf, childRunsOf, MAX_CHILD_ACTORS } from '@/web/scene/sim/team/goals'
import { createMember, type Member, sendTo } from '@/web/scene/sim/team/members'
import { parentOf, type TeamState } from '@/web/scene/sim/team/state'
import { DESK_SLOTS } from '@/web/scene/world/floors'
import { TEAM_SEATS } from '@/web/scene/world/seats'

interface SyncAt {
  readonly nowMs: number
  /** Back from a hidden spell: everyone is placed, nobody walks in. */
  readonly isResume: boolean
}

/** Brings the floor's people in line with the roster and the live runs: one desk per own agent in
 *  the order they came, a child per spawned run. True when anyone came or went. */
export function syncMembers(state: TeamState, at: SyncAt): boolean {
  const isAgentsChanged = syncAgents(state, at)
  const isChildrenChanged = syncChildren(state, at)

  if (at.isResume) {
    placeEveryone(state)
  }

  state.isSeeded = true

  return isAgentsChanged || isChildrenChanged
}

// A desk stays with its agent; a new agent takes the first free one, and past the last none.
function syncAgents(state: TeamState, at: SyncAt): boolean {
  const roster = state.deps.agents.value
  const ids = new Set(roster.map((agent) => agent.id))
  let isChanged = false

  for (const member of [...state.members.values()]) {
    if (member.agentId !== undefined && !ids.has(member.agentId)) {
      state.members.delete(member.id)
      state.bursts.delete(member.id)
      isChanged = true
    }
  }

  for (const agent of roster) {
    const held = state.members.get(ownActorIdOf(agent.id))

    if (held !== undefined) {
      held.look = agent.look
    } else {
      isChanged = addAgent(state, { agent, nowMs: at.nowMs }) || isChanged
    }
  }

  return isChanged
}

function addAgent(
  state: TeamState,
  add: { readonly agent: AgentWire; readonly nowMs: number }
): boolean {
  const { agent } = add
  const taken = new Set([...state.members.values()].map((held) => held.slot))
  const slot = DESK_SLOTS.findIndex((_, index) => !taken.has(index))
  const seat = TEAM_SEATS[slot]

  if (seat === undefined) {
    return false
  }

  const member = createMember({
    id: ownActorIdOf(agent.id),
    at: seat.at,
    seat,
    slot,
    agentId: agent.id,
    ...(agent.look === undefined ? {} : { look: agent.look }),
  })

  state.members.set(member.id, member)

  if (state.arrivals.delete(agent.id)) {
    startArrival(state, member, add.nowMs)
  }

  return true
}

function syncChildren(state: TeamState, at: SyncAt): boolean {
  const runs = state.deps.runs.value
  const live = new Set(runs.map((run) => run.runId))
  let isChanged = false

  for (const member of [...state.members.values()]) {
    isChanged = dropUnheard(state, { member, live, isResume: at.isResume }) || isChanged
  }

  for (const run of childRunsOf(runs)) {
    if (!state.members.has(childActorIdOf(run.runId)) && countChildren(state) < MAX_CHILD_ACTORS) {
      addChild(state, { run, runs, isPlaced: at.isResume || !state.isSeeded })
      isChanged = true
    }
  }

  return isChanged
}

// A child whose run left the feed with no end heard (a reconnect's snapshot) goes on the next
// step; one that finished walks its answer back first.
function dropUnheard(
  state: TeamState,
  job: { readonly member: Member; readonly live: ReadonlySet<string>; readonly isResume: boolean }
): boolean {
  const { member } = job
  const runId = member.child?.runId

  if (runId === undefined || member.outcome !== undefined || job.live.has(runId)) {
    state.missing.delete(member.id)
    return false
  }

  if (!(job.isResume || state.missing.has(member.id))) {
    state.missing.add(member.id)
    return false
  }

  state.missing.delete(member.id)
  state.members.delete(member.id)

  return true
}

interface ChildAdd {
  readonly run: ReturnType<typeof childRunsOf>[number]
  readonly runs: readonly Run[]
  readonly isPlaced: boolean
}

// A child stands where a new one comes in, beside its parent, and walks to the seat it takes; a
// child read from a snapshot is placed there.
function addChild(state: TeamState, add: ChildAdd): void {
  const { run } = add
  const parentRun = add.runs.find((held) => held.runId === run.parentRunId)
  const parentAgentId = parentRun?.kind === 'agent' ? parentRun.agentId : undefined
  const child = {
    runId: run.runId,
    parentRunId: run.parentRunId,
    role: childRoleOf(run.title),
    ...(parentAgentId === undefined ? {} : { parentAgentId }),
  }
  const parent = parentOf(state, child)
  const place = childPlaceOf([...state.members.values()], parent)
  const entry = add.isPlaced ? place.seat.at : childEntryOf(parent, countChildren(state))
  const member = createMember({
    id: childActorIdOf(run.runId),
    at: entry,
    seat: place.seat,
    ...(place.slot === undefined ? {} : { slot: place.slot }),
    child,
  })

  state.members.set(member.id, member)

  if (!add.isPlaced) {
    sendTo(member, 'home', place.seat.at)
  }
}

function countChildren(state: TeamState): number {
  return [...state.members.values()].filter((member) => member.child !== undefined).length
}

// A child already done leaves at once; a talk or a greeting is cut short; everyone sits down.
function placeEveryone(state: TeamState): void {
  for (const member of [...state.members.values()]) {
    if (member.outcome !== undefined) {
      state.members.delete(member.id)
      continue
    }

    member.task = 'home'
    member.dest = member.seat.at
    member.isArrived = true
    member.isNewcomer = false
    member.face = undefined
    member.taskUntil = Number.POSITIVE_INFINITY
    placeWalker(member.walker, member.seat.at)
  }

  state.talk = undefined
  state.lines = []
}
