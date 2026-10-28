import type { Member } from '@/web/scene/sim/team/members'
import type {
  BurstView,
  CalendarView,
  ChildView,
  DeskView,
  Point,
  TeamView,
  ThreadView,
} from '@/web/scene/types'
import { nextExDate } from '@/web/scene/data/ex-dividends'
import { ownActorIdOf } from '@/web/scene/sim/actors/roster'
import { incomeAgent } from '@/web/scene/sim/rhythm'
import { deskFocusOf } from '@/web/scene/sim/team/goals'
import { agentMemberOf, isOnDuty, isWorking, type TeamState } from '@/web/scene/sim/team/state'
import { DESK_SLOTS } from '@/web/scene/world/floors'

// A thread leaves the parent's desk at its screen, and reaches the child at its chest.
const THREAD_FROM_DX = 20
const THREAD_FROM_DY = 4
const THREAD_TO_RISE = 20

/** What the renderers and overlays draw of the team floor now. */
export function buildTeamView(state: TeamState, nowMs: number): TeamView {
  const members = [...state.members.values()]
  const children = members.filter((member) => member.child !== undefined)
  const calendar = calendarOf(state)

  return {
    ...(calendar === undefined ? {} : { calendar }),
    desks: DESK_SLOTS.map((_, slot) => toDesk(state, { slot, members, children })),
    children: children.flatMap(toChildView),
    threads: children.flatMap((child) => toThread(state, child)),
    bursts: [...state.bursts.values()].filter((burst) => burst.untilMs > nowMs).map(toBurst),
    lines: state.lines.filter((line) => line.untilMs > nowMs),
  }
}

interface DeskJob {
  readonly slot: number
  readonly members: readonly Member[]
  readonly children: readonly Member[]
}

function toDesk(state: TeamState, job: DeskJob): DeskView {
  const owner = job.members.find(
    (member) => member.agentId !== undefined && member.slot === job.slot
  )
  const agent = state.deps.agents.value.find((held) => held.id === owner?.agentId)
  const seated = job.members.filter((member) => member.slot === job.slot)
  const own = job.children.filter(
    (child) => owner !== undefined && child.child?.parentAgentId === owner.agentId
  )

  return {
    slot: job.slot,
    ...(agent === undefined ? {} : { agentId: agent.id, focus: deskFocusOf(agent) }),
    isGlowing:
      agent !== undefined && !agent.paused && (owner === undefined || isOnDuty(state, owner)),
    isTaken: seated.some((member) => member.task !== 'exit' && isOnDuty(state, member)),
    isLit: seated.some((member) => isWorking(state, member)),
    childrenOpen: own.filter((child) => child.outcome === undefined).length,
    childrenBack: own.filter((child) => child.task === 'carry').length,
  }
}

// The income agent's desk keeps a calendar with the next ex-dividend date of a held name circled.
function calendarOf(state: TeamState): CalendarView | undefined {
  const agent = incomeAgent.value
  const slot = agent === undefined ? undefined : state.members.get(ownActorIdOf(agent.id))?.slot
  const next = nextExDate.value

  return slot === undefined || next === undefined ? undefined : { slot, day: next.day }
}

function toChildView(member: Member): ChildView[] {
  const { child } = member

  if (child === undefined) {
    return []
  }

  return [
    {
      actor: member.id,
      role: child.role,
      parentRunId: child.parentRunId,
      ...(child.parentAgentId === undefined ? {} : { parentAgentId: child.parentAgentId }),
    },
  ]
}

// Only an open child of a parent at a desk on this floor has a thread.
function toThread(state: TeamState, child: Member): ThreadView[] {
  const parentAgentId = child.child?.parentAgentId
  const parent = parentAgentId === undefined ? undefined : agentMemberOf(state, parentAgentId)
  const desk = parent?.slot === undefined ? undefined : DESK_SLOTS[parent.slot]

  if (desk === undefined || child.outcome !== undefined) {
    return []
  }

  const from: Point = { x: desk.x + THREAD_FROM_DX, y: desk.y + THREAD_FROM_DY }
  const to: Point = { x: child.walker.pos.x, y: child.walker.pos.y - THREAD_TO_RISE }

  return [{ from, to }]
}

function toBurst(burst: BurstView & { readonly untilMs: number }): BurstView {
  return { at: burst.at, tone: burst.tone, since: burst.since }
}
