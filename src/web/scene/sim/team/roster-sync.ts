import type { AgentWire } from '@/app/server/wire/agents'
import type { Run } from '@/web/state/live'
import { kidActorIdOf, ownActorIdOf } from '@/web/scene/sim/actors/roster'
import { placeWalker } from '@/web/scene/sim/actors/walk'
import { startArrival } from '@/web/scene/sim/team/events'
import { kidRoleOf, kidRunsOf, MAX_CHILD_ACTORS } from '@/web/scene/sim/team/goals'
import { kidEntryOf, kidPlaceOf } from '@/web/scene/sim/team/kids'
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
  const isKidsChanged = syncKids(state, at)

  if (at.isResume) {
    placeEveryone(state)
  }

  state.isSeeded = true

  return isAgentsChanged || isKidsChanged
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

function syncKids(state: TeamState, at: SyncAt): boolean {
  const runs = state.deps.runs.value
  const live = new Set(runs.map((run) => run.runId))
  let isChanged = false

  for (const member of [...state.members.values()]) {
    isChanged = dropUnheard(state, { member, live, isResume: at.isResume }) || isChanged
  }

  for (const run of kidRunsOf(runs)) {
    if (!state.members.has(kidActorIdOf(run.runId)) && countKids(state) < MAX_CHILD_ACTORS) {
      addKid(state, { run, runs, isPlaced: at.isResume || !state.isSeeded })
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
  const runId = member.kid?.runId

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

interface KidAdd {
  readonly run: ReturnType<typeof kidRunsOf>[number]
  readonly runs: readonly Run[]
  readonly isPlaced: boolean
}

// A child stands where a new one comes in, beside its parent, and walks to the seat it takes; a
// child read from a snapshot is placed there.
function addKid(state: TeamState, add: KidAdd): void {
  const { run } = add
  const parentRun = add.runs.find((held) => held.runId === run.parentRunId)
  const parentAgentId = parentRun?.kind === 'agent' ? parentRun.agentId : undefined
  const kid = {
    runId: run.runId,
    parentRunId: run.parentRunId,
    role: kidRoleOf(run.title),
    ...(parentAgentId === undefined ? {} : { parentAgentId }),
  }
  const parent = parentOf(state, kid)
  const place = kidPlaceOf([...state.members.values()], parent)
  const entry = add.isPlaced ? place.seat.at : kidEntryOf(parent, countKids(state))
  const member = createMember({
    id: kidActorIdOf(run.runId),
    at: entry,
    seat: place.seat,
    ...(place.slot === undefined ? {} : { slot: place.slot }),
    kid,
  })

  state.members.set(member.id, member)

  if (!add.isPlaced) {
    sendTo(member, 'home', place.seat.at)
  }
}

function countKids(state: TeamState): number {
  return [...state.members.values()].filter((member) => member.kid !== undefined).length
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
