import type { Member } from '@/web/scene/sim/team/members'
import { isAtHome, sendTo } from '@/web/scene/sim/team/members'
import { addLine, type TeamState } from '@/web/scene/sim/team/state'
import { TEAM_LIFT_EXIT } from '@/web/scene/world/seats'

// A child holds its answer out this long at its parent's desk before it leaves.
const HAND_OVER_MS = 1_600

/** Ends the tasks that are done: a wave walks on to the desk, a cooler talk goes home, a child
 *  hands its answer over and then leaves by the lift. True when anyone's task changed. */
export function finishTasks(state: TeamState, nowMs: number): boolean {
  let isChanged = false

  for (const member of [...state.members.values()]) {
    isChanged = finishTask(state, { member, nowMs }) || isChanged
  }

  return isChanged
}

function finishTask(
  state: TeamState,
  job: { readonly member: Member; readonly nowMs: number }
): boolean {
  const { member, nowMs } = job

  if (member.task === 'home') {
    return member.isNewcomer && isAtHome(member) && welcome(state, { member, nowMs })
  }

  if (!member.isArrived) {
    return false
  }

  if (member.task === 'exit') {
    state.members.delete(member.id)
    return true
  }

  if (member.task === 'carry' && member.taskUntil === Number.POSITIVE_INFINITY) {
    member.taskUntil = nowMs + HAND_OVER_MS
    return true
  }

  return nowMs >= member.taskUntil && moveOn(member)
}

// After the wave the desk; after the cooler home again; after the hand-over out by the lift.
function moveOn(member: Member): boolean {
  member.face = undefined

  if (member.task === 'carry') {
    sendTo(member, 'exit', TEAM_LIFT_EXIT)
  } else {
    sendTo(member, 'home', member.seat.at)
  }

  return true
}

// At its desk the newcomer is answered by the first colleague sitting at theirs.
function welcome(
  state: TeamState,
  job: { readonly member: Member; readonly nowMs: number }
): boolean {
  const { member } = job
  const name = state.deps.agents.value.find((agent) => agent.id === member.agentId)?.name
  const paused = new Set(
    state.deps.agents.value.filter((agent) => agent.paused).map((agent) => agent.id)
  )
  const colleague = [...state.members.values()].find(
    (other) =>
      other !== member &&
      other.agentId !== undefined &&
      !paused.has(other.agentId) &&
      !other.isNewcomer &&
      isAtHome(other)
  )

  member.isNewcomer = false

  if (colleague !== undefined && name !== undefined) {
    addLine(state, { actor: colleague.id, say: { kind: 'hello-reply', name } }, job.nowMs)
  }

  return true
}
