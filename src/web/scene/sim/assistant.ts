import type { Goal } from '@/web/scene/sim/vocabulary'
import type { PropKind } from '@/web/scene/world/props'
import { TRAY_AT } from '@/web/scene/world/seats'

/** A pending request no actor of its run stands for (a queued run, or a run from another
 *  channel): the assistant carries its sheet to your tray. `runId` is bookkeeping only: the carry
 *  never credits the assistant with that run. */
export interface Orphan {
  readonly requestId: string
  readonly runId: string
}

/** The assistant's own walks: a read it goes to fetch, and a carry to your tray. `carried` holds
 *  the requests already brought, only while they are still pending. */
export interface AssistantWalks {
  trip: { readonly runId: string; readonly at: PropKind; readonly dueAt: number } | undefined
  carry: { readonly requestIds: readonly string[]; readonly goal: Goal } | undefined
  carried: Set<string>
}

/** What the assistant is doing now, as the carry needs to know it. */
interface AssistantNow {
  /** No run of its own, standing still where its goal put it. */
  readonly isFree: boolean
  /** It holds the carry goal and stands where it put it. */
  readonly isAtCarry: boolean
  /** Office hours by the page clock; at night the tray fills with no walk. */
  readonly isOpen: boolean
  /** Reduced motion: the sheet is delivered to the tray with no walk. */
  readonly isReduced: boolean
}

const TRIP_AFTER_MS = 5_000
// While a carry waits for the assistant to come free, the director looks again this often.
const CARRY_RECHECK_MS = 1_000

export function createAssistantWalks(): AssistantWalks {
  return { trip: undefined, carry: undefined, carried: new Set() }
}

/** A read in the assistant's run: it walks to the prop once the read has run `TRIP_AFTER_MS`. */
export function startTrip(
  walks: AssistantWalks,
  read: { readonly runId: string; readonly at: PropKind; readonly ownRunId?: string },
  nowMs: number
): void {
  if (read.ownRunId === read.runId) {
    walks.trip = { runId: read.runId, at: read.at, dueAt: nowMs + TRIP_AFTER_MS }
  }
}

/** The read ended: a trip not yet begun never begins, one under way turns back. */
export function endTrip(walks: AssistantWalks, runId: string): void {
  if (walks.trip?.runId === runId) {
    walks.trip = undefined
  }
}

/** One step of the carry: start one walk for every request not yet brought while the assistant is
 *  free and the office open; at the tray they count as brought; when every one it carries was
 *  answered on the way, it turns back. */
export function stepCarry(
  walks: AssistantWalks,
  orphans: readonly Orphan[],
  now: AssistantNow & { readonly nowMs: number }
): void {
  const pendingIds = new Set(orphans.map((orphan) => orphan.requestId))

  for (const id of [...walks.carried].filter((held) => !pendingIds.has(held))) {
    walks.carried.delete(id)
  }

  const carry = walks.carry

  if (carry !== undefined) {
    const isAnswered = !carry.requestIds.some((id) => pendingIds.has(id))

    if (now.isAtCarry || isAnswered) {
      markCarried(walks, carry.requestIds)
      walks.carry = undefined
    }

    return
  }

  const due = orphans.filter((orphan) => !walks.carried.has(orphan.requestId))
  const requestIds = due.map((orphan) => orphan.requestId)

  if (due.length > 0 && now.isReduced) {
    markCarried(walks, requestIds)
  } else if (due.length > 0 && now.isFree && now.isOpen) {
    walks.carry = { requestIds, goal: carryGoal(now.nowMs) }
  }
}

/** A carry is under way or owed, or a read's trip is: the assistant has somewhere to be. */
export function isAssistantOwed(walks: AssistantWalks, orphans: readonly Orphan[]): boolean {
  const isCarryOwed = orphans.some((orphan) => !walks.carried.has(orphan.requestId))

  return walks.carry !== undefined || walks.trip !== undefined || isCarryOwed
}

/** When to look again for a carry that waits on the assistant: soon while one is owed. */
export function carryDueOf(
  walks: AssistantWalks,
  orphans: readonly Orphan[],
  nowMs: number
): number {
  const isOwed =
    walks.carry === undefined && orphans.some((orphan) => !walks.carried.has(orphan.requestId))

  return isOwed ? nowMs + CARRY_RECHECK_MS : Number.POSITIVE_INFINITY
}

/** The assistant's goal now: the carry over everything, then a trip that has come due, else the
 *  goal the live store gives it. */
export function assistantGoalOf(
  walks: AssistantWalks,
  goal: Goal | undefined,
  nowMs: number
): Goal | undefined {
  if (walks.carry !== undefined) {
    return walks.carry.goal
  }

  const trip = walks.trip
  const isTripDue = trip !== undefined && trip.runId === goal?.runId && nowMs >= trip.dueAt

  return goal !== undefined && isTripDue ? { ...goal, target: trip.at, pose: 'reach' } : goal
}

/** Back from a hidden spell: no trip or carry is under way; what was pending is on the tray. */
export function resumeWalks(walks: AssistantWalks, orphans: readonly Orphan[]): void {
  walks.trip = undefined
  walks.carry = undefined
  markCarried(
    walks,
    orphans.map((orphan) => orphan.requestId)
  )
}

function markCarried(walks: AssistantWalks, requestIds: readonly string[]): void {
  for (const id of requestIds) {
    walks.carried.add(id)
  }
}

// Not work: no run is the assistant's for it, so "Xem" on the waiting run never picks it.
function carryGoal(nowMs: number): Goal {
  return { kind: 'life', target: TRAY_AT, pose: 'carry', since: nowMs, hasSheet: true }
}
