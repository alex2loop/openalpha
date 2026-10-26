import type { Member } from '@/web/scene/sim/team/members'
import type { BurstView, DeskView, KidView, Point, TeamView, ThreadView } from '@/web/scene/types'
import { deskFocusOf } from '@/web/scene/sim/team/goals'
import { agentMemberOf, isWorking, type TeamState } from '@/web/scene/sim/team/state'
import { DESK_SLOTS } from '@/web/scene/world/floors'

// A thread leaves the parent's desk at its screen, and reaches the child at its chest.
const THREAD_FROM_DX = 20
const THREAD_FROM_DY = 4
const THREAD_TO_RISE = 20

/** What the renderers and overlays draw of the team floor now. */
export function buildTeamView(state: TeamState, nowMs: number): TeamView {
  const members = [...state.members.values()]
  const kids = members.filter((member) => member.kid !== undefined)

  return {
    desks: DESK_SLOTS.map((_, slot) => toDesk(state, { slot, members, kids })),
    kids: kids.flatMap(toKidView),
    threads: kids.flatMap((kid) => toThread(state, kid)),
    bursts: [...state.bursts.values()].filter((burst) => burst.untilMs > nowMs).map(toBurst),
    lines: state.lines.filter((line) => line.untilMs > nowMs),
  }
}

interface DeskJob {
  readonly slot: number
  readonly members: readonly Member[]
  readonly kids: readonly Member[]
}

function toDesk(state: TeamState, job: DeskJob): DeskView {
  const owner = job.members.find(
    (member) => member.agentId !== undefined && member.slot === job.slot
  )
  const agent = state.deps.agents.value.find((held) => held.id === owner?.agentId)
  const seated = job.members.filter((member) => member.slot === job.slot)
  const own = job.kids.filter(
    (kid) => owner !== undefined && kid.kid?.parentAgentId === owner.agentId
  )

  return {
    slot: job.slot,
    ...(agent === undefined ? {} : { agentId: agent.id, focus: deskFocusOf(agent) }),
    isGlowing: agent !== undefined && !agent.paused,
    isLit: seated.some((member) => isWorking(state, member)),
    kidsOpen: own.filter((kid) => kid.outcome === undefined).length,
    kidsBack: own.filter((kid) => kid.task === 'carry').length,
  }
}

function toKidView(member: Member): KidView[] {
  const { kid } = member

  if (kid === undefined) {
    return []
  }

  return [
    {
      actor: member.id,
      role: kid.role,
      parentRunId: kid.parentRunId,
      ...(kid.parentAgentId === undefined ? {} : { parentAgentId: kid.parentAgentId }),
    },
  ]
}

// Only an open child of a parent at a desk on this floor has a thread.
function toThread(state: TeamState, kid: Member): ThreadView[] {
  const parentAgentId = kid.kid?.parentAgentId
  const parent = parentAgentId === undefined ? undefined : agentMemberOf(state, parentAgentId)
  const desk = parent?.slot === undefined ? undefined : DESK_SLOTS[parent.slot]

  if (desk === undefined || kid.outcome !== undefined) {
    return []
  }

  const from: Point = { x: desk.x + THREAD_FROM_DX, y: desk.y + THREAD_FROM_DY }
  const to: Point = { x: kid.walker.pos.x, y: kid.walker.pos.y - THREAD_TO_RISE }

  return [{ from, to }]
}

function toBurst(burst: BurstView & { readonly untilMs: number }): BurstView {
  return { at: burst.at, tone: burst.tone, since: burst.since }
}
