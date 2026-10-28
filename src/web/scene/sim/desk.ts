import type { PendingWire } from '@/app/server/wire/live'
import type { Goal } from '@/web/scene/sim/vocabulary'
import type { ActorId } from '@/web/scene/types'
import { pageNow } from '@/web/scene/clock/clock'
import { askedAtOf } from '@/web/scene/sim/vocabulary'
import { setCapped } from '@/web/state/capped-map'
import { APPROVAL_KIND, pendingRequestId } from '@/web/state/live'

/** A request one person waits on at your desk: when the page first saw it, when the foot taps. */
interface DeskWait {
  readonly actor: ActorId
  firstSeenAt: number
  readonly tapAt: number
  isTapped: boolean
  readonly askedAt?: number
  readonly expiresAt?: number
}

/** The waits under way, and the ones just answered (kept for the beat their answer plays). */
export interface Desk {
  readonly waits: Map<string, DeskWait>
  readonly answered: Map<string, DeskWait>
}

/** The walk to your desk starts this long after the page first sees the request. */
const DESK_WALK_AFTER_MS = 5_000
const FOOT_TAP_AFTER_MS = 30_000
const MAX_ANSWERED_DESKS = 8

export function createDesk(): Desk {
  return { waits: new Map(), answered: new Map() }
}

/** Starts a wait for each request a goal now holds and moves the ones no goal holds to
 *  `answered`. */
export function syncDesk(
  desk: Desk,
  update: { readonly goals: ReadonlyMap<ActorId, Goal>; readonly pending: readonly PendingWire[] },
  nowMs: number
): void {
  const held = new Map<string, ActorId>()

  for (const [actor, goal] of update.goals) {
    if (goal.requestId !== undefined) {
      held.set(goal.requestId, actor)
    }
  }

  for (const [requestId, wait] of desk.waits) {
    if (!held.has(requestId)) {
      desk.waits.delete(requestId)
      setCapped(desk.answered, [requestId, wait], MAX_ANSWERED_DESKS)
    }
  }

  for (const [requestId, actor] of held) {
    if (!desk.waits.has(requestId)) {
      const entry = update.pending.find((item) => pendingRequestId(item) === requestId)

      desk.waits.set(requestId, toDeskWait(actor, entry, nowMs))
    }
  }
}

export function isDeskDue(wait: DeskWait | undefined, nowMs: number): boolean {
  return wait !== undefined && nowMs >= wait.firstSeenAt + DESK_WALK_AFTER_MS
}

/** After a hidden spell, a request older than the desk delay by the page clock is due at once. */
export function catchUpDesk(desk: Desk, nowMs: number): void {
  for (const wait of desk.waits.values()) {
    const age = wait.askedAt === undefined ? 0 : pageNow() - wait.askedAt

    if (age >= DESK_WALK_AFTER_MS) {
      wait.firstSeenAt = Math.min(wait.firstSeenAt, nowMs - DESK_WALK_AFTER_MS)
    }
  }
}

/** The deadlines ahead: each walk's start and each foot tap not yet played. */
export function deskDues(desk: Desk): number[] {
  return [...desk.waits.values()].flatMap((wait) => [
    wait.firstSeenAt + DESK_WALK_AFTER_MS,
    wait.isTapped ? Number.POSITIVE_INFINITY : wait.tapAt,
  ])
}

// The foot tap counts from `askedAt` (from the page's first sight when the wire has none).
function toDeskWait(actor: ActorId, entry: PendingWire | undefined, nowMs: number): DeskWait {
  const askedAt = entry === undefined ? undefined : askedAtOf(entry)
  const expiresAt = entry?.kind === APPROVAL_KIND ? entry.event.approval?.expiresAt : undefined
  const waited = askedAt === undefined ? 0 : pageNow() - askedAt
  const age = Math.min(FOOT_TAP_AFTER_MS, Math.max(0, waited))

  return {
    actor,
    firstSeenAt: nowMs,
    tapAt: nowMs + FOOT_TAP_AFTER_MS - age,
    isTapped: false,
    ...(askedAt === undefined ? {} : { askedAt }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  }
}
