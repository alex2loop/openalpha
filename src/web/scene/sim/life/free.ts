import type { AgendaRow } from '@/web/scene/data/agenda'
import type { ActorState } from '@/web/scene/sim/director'
import type { LifeState } from '@/web/scene/sim/life/state'
import type { Errands } from '@/web/scene/sim/street/errands'
import type { ActorId, ActorStatus, ActorView } from '@/web/scene/types'
import { pageMinute } from '@/web/scene/clock/clock'
import { agenda } from '@/web/scene/data/agenda'
import { breachedStops } from '@/web/scene/data/room-status'
import { ASSISTANT, rosterDefOf } from '@/web/scene/sim/actors/roster'
import { isKept } from '@/web/scene/sim/rhythm'
import { isOnErrand } from '@/web/scene/sim/street/errands'
import { MS_PER_MINUTE } from '@/web/text/time-units'

/** A job within this of its run sits its owner up. */
const JOB_DUE_MS = 600_000
const BRIEF_ROW_KEY = 'brief'
const BRIEF_OWNER: ActorId = 'pm'
const CLERK: ActorId = 'clerk'

/** Free for the office life: no goal the live store calls for (no work, no approval or question,
 *  no walk to your desk), no gesture of a real event, no marker over the head, no job due within
 *  `JOB_DUE_MS`, not out on an errand, not on the way in or out of the office, not kept at the desk
 *  by the day, not the mascot; staff only, never a temporary child or an own agent. */
export function isFree(
  actor: ActorState,
  at: { readonly errands: Errands; readonly due: ReadonlyMap<ActorId, AgendaRow> }
): boolean {
  const id = actor.def.id
  const isMarked = id === CLERK && (breachedStops.value?.length ?? 0) > 0
  const hasBeat = actor.beats.some((beat) => beat.kind !== 'life')

  return (
    id !== ASSISTANT &&
    isStaffId(id) &&
    (actor.goal === undefined || actor.isLife) &&
    !hasBeat &&
    !isMarked &&
    !at.due.has(id) &&
    !isOnErrand(at.errands, id) &&
    actor.away === undefined &&
    !isKept(id)
  )
}

// No dot while someone works or walks to their work (the rim and the walk say so); red after an
// error until the next run; amber for an approval or a question, a carry owed, or a job due.
export function statusesOf(
  state: LifeState,
  views: readonly ActorView[]
): ReadonlyMap<ActorId, ActorStatus> {
  const held = state.director.actors()
  const due = dueOwners()
  const statuses = new Map<ActorId, ActorStatus>()

  for (const view of views) {
    const actor = held.get(view.id)
    const isShown = actor !== undefined && !view.working && view.isCrew !== true
    const status = isShown ? statusOf(state, { actor, due }) : undefined

    if (status !== undefined) {
      statuses.set(view.id, status)
    }
  }

  return statuses
}

function statusOf(
  state: LifeState,
  at: { readonly actor: ActorState; readonly due: ReadonlyMap<ActorId, AgendaRow> }
): ActorStatus | undefined {
  const { actor } = at
  const goal = actor.isLife ? undefined : actor.goal

  if (state.failed.has(actor.def.id)) {
    return 'failed'
  }

  if (goal?.requestId !== undefined || actor.isOwed || at.due.has(actor.def.id)) {
    return 'waiting'
  }

  return goal === undefined ? 'free' : undefined
}

// The owner of each job that runs within `JOB_DUE_MS` by the page clock: the brief is the
// manager's, a scheduled job its agent's.
export function dueOwners(): ReadonlyMap<ActorId, AgendaRow> {
  const { rows } = agenda.value
  const now = pageMinute.value.minute
  const owners = new Map<ActorId, AgendaRow>()

  for (const row of rows) {
    const untilMs = (row.minute - now) * MS_PER_MINUTE
    const owner = row.key === BRIEF_ROW_KEY ? BRIEF_OWNER : row.agentId

    if (owner !== undefined && untilMs > 0 && untilMs <= JOB_DUE_MS && isStaffId(owner)) {
      owners.set(owner, row)
    }
  }

  return owners
}

function isStaffId(id: string): id is ActorId {
  return rosterDefOf(id) !== undefined
}
