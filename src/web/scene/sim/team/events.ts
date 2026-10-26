import type { WireEvent } from '@/app/server/wire/events'
import type { Member } from '@/web/scene/sim/team/members'
import type { Point } from '@/web/scene/types'
import { childActorIdOf } from '@/web/scene/sim/actors/roster'
import { placeWalker } from '@/web/scene/sim/actors/walk'
import { handOverOf } from '@/web/scene/sim/team/children'
import { sendTo } from '@/web/scene/sim/team/members'
import {
  addLine,
  agentMemberOf,
  parentOf,
  type Tally,
  type TeamState,
} from '@/web/scene/sim/team/state'
import { DESK_SLOTS } from '@/web/scene/world/floors'
import { TEAM_LIFT_EXIT } from '@/web/scene/world/seats'
import { setCapped } from '@/web/state/capped-map'
import { CHILD_PARTIAL_KEY, childOutcomeKey } from '@/web/text/child-outcome'

/** The parents whose children came back unfinished, kept while their children can. */
const MAX_TALLIES = 12
// Agents heard as added before the roster lists them, and desks bursting at once: one per desk.
const MAX_ARRIVALS = DESK_SLOTS.length
const MAX_BURSTS = DESK_SLOTS.length
const BURST_MS = 2_400
const WAVE_MS = 1_600
// A scored call bursts at the desk's front edge, this far below the seat.
const BURST_DY = 30
// The progress lines of a `spawn` call asked for more children than may work at once.
const SPAWN_FULL_KEYS: ReadonlySet<string> = new Set(['tools.spawn.full', 'tools.spawn.fullOne'])
const COMPLETED = 'completed'

/** Subscribes the team floor to the events it plays; the returned stop drops every one. */
export function listenTeam(state: TeamState): () => void {
  const { hub } = state.deps
  const offs = [
    hub('agent_added', (event) => onAgentAdded(state, event)),
    hub('call_scored', (event) => onCallScored(state, event)),
    hub('run_progress', (event) => onProgress(state, event)),
    hub('run_finished', (event) => onRunFinished(state, event)),
  ]

  return () => {
    for (const off of offs) {
      off()
    }
  }
}

/** A new agent steps out of the lift waving and says hello, then walks to its desk. */
export function startArrival(state: TeamState, member: Member, nowMs: number): void {
  const name = state.deps.agents.value.find((agent) => agent.id === member.agentId)?.name

  placeWalker(member.walker, TEAM_LIFT_EXIT)
  member.task = 'wave'
  member.dest = TEAM_LIFT_EXIT
  member.isArrived = true
  member.isNewcomer = true
  member.taskUntil = nowMs + WAVE_MS

  if (name !== undefined) {
    addLine(state, { actor: member.id, say: { kind: 'hello', name } }, nowMs)
  }
}

// The roster may list the agent before the event arrives, or after.
function onAgentAdded(state: TeamState, event: WireEvent): void {
  const agentId = event.agent?.agentId
  const member = agentId === undefined ? undefined : agentMemberOf(state, agentId)

  if (member !== undefined) {
    startArrival(state, member, performance.now())
  } else if (agentId !== undefined) {
    setCapped(state.arrivals, [agentId, true], MAX_ARRIVALS)
  }
}

// Only an own agent's focus call is scored at its desk; an expired one shows nothing.
function onCallScored(state: TeamState, event: WireEvent): void {
  const status = event.call?.status
  const member = agentMemberOf(state, event.source.agentId)

  if (member === undefined || (status !== 'target' && status !== 'stop')) {
    return
  }

  const nowMs = performance.now()
  const at: Point = { x: member.seat.at.x, y: member.seat.at.y + BURST_DY }

  setCapped(
    state.bursts,
    [member.id, { at, tone: status, since: nowMs, untilMs: nowMs + BURST_MS }],
    MAX_BURSTS
  )
}

function onProgress(state: TeamState, event: WireEvent): void {
  const { progress, runId } = event

  if (progress !== undefined && runId !== undefined && SPAWN_FULL_KEYS.has(progress.key)) {
    addLine(state, { runId, say: { kind: 'daemon', text: progress.text } }, performance.now())
  }
}

// A child carries its answer back to its parent and leaves; an unfinished one says why, and its
// parent says what it combines with.
function onRunFinished(state: TeamState, event: WireEvent): void {
  const { runId } = event

  if (runId === undefined) {
    return
  }

  state.tallies.delete(runId)

  const child = state.members.get(childActorIdOf(runId))

  if (child?.child === undefined) {
    return
  }

  const nowMs = performance.now()
  const outcome = event.outcome ?? COMPLETED
  const parent = parentOf(state, child.child)

  state.missing.delete(child.id)
  child.outcome = outcome
  sayUnfinished(state, { child, outcome }, nowMs)

  if (parent === undefined) {
    sendTo(child, 'exit', TEAM_LIFT_EXIT)
    return
  }

  child.face = parent.id
  sendTo(child, 'carry', handOverOf(parent))
}

function sayUnfinished(
  state: TeamState,
  ended: { readonly child: Member; readonly outcome: string },
  nowMs: number
): void {
  const key = childOutcomeKey(ended.outcome)
  const parentRunId = ended.child.child?.parentRunId

  if (key === undefined || parentRunId === undefined) {
    return
  }

  const held: Tally = state.tallies.get(parentRunId) ?? { partial: 0, stopped: 0 }
  const tally: Tally =
    key === CHILD_PARTIAL_KEY
      ? { ...held, partial: held.partial + 1 }
      : { ...held, stopped: held.stopped + 1 }

  setCapped(state.tallies, [parentRunId, tally], MAX_TALLIES)
  addLine(
    state,
    { actor: ended.child.id, say: { kind: 'child-end', outcome: ended.outcome } },
    nowMs
  )
  addLine(state, { runId: parentRunId, say: { kind: 'children-folding', ...tally } }, nowMs)
}
