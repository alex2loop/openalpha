import type { ActorState, Director } from '@/web/scene/sim/director'
import type { Goal } from '@/web/scene/sim/vocabulary'
import type { ActorId, FloorId, HeldItem, LifeLine, Point, PoseId } from '@/web/scene/types'
import { isWalking } from '@/web/scene/sim/actors/walk'
import { SEAT_TARGET } from '@/web/scene/sim/vocabulary'

export type MomentKind =
  | 'idle'
  | 'coffee'
  | 'dessert'
  | 'standup'
  | 'watch'
  | 'chat'
  | 'look'
  | 'round'

/** One stop of a moment: where its goal puts the person, held `holdMs` once they stand there, and
 *  what they say meanwhile. */
interface MomentStop {
  readonly goal: Goal
  readonly holdMs: number
  readonly line?: LifeLine
}

/** A short trip or turn of one free person; it ends at their seat, with `item` in hand when it
 *  brought one back. */
export interface Moment {
  readonly kind: MomentKind
  readonly actor: ActorId
  readonly stops: readonly [MomentStop, ...MomentStop[]]
  readonly line?: LifeLine
  readonly item?: HeldItem
  index: number
  holdUntil: number | undefined
}

/** Where a stop puts the person: a place, or their own seat (turned, posed). */
export interface StopSpec {
  readonly at?: Point
  readonly pose: PoseId
  readonly face?: ActorId
  readonly look?: Point
  readonly holdMs: number
  readonly line?: LifeLine
  readonly item?: HeldItem
  readonly floor?: FloorId
}

export function toStop(spec: StopSpec, sinceMs: number): MomentStop {
  const goal: Goal = {
    kind: 'life',
    target: spec.at ?? SEAT_TARGET,
    pose: spec.pose,
    since: sinceMs,
    ...(spec.face === undefined ? {} : { face: spec.face }),
    ...(spec.look === undefined ? {} : { look: spec.look }),
    ...(spec.item === undefined ? {} : { item: spec.item }),
    ...(spec.floor === undefined ? {} : { floor: spec.floor }),
  }

  return { goal, holdMs: spec.holdMs, ...(spec.line === undefined ? {} : { line: spec.line }) }
}

/** Starts the moment: its first stop's goal goes to the director. */
export function beginMoment(director: Director, moment: Moment): Moment {
  director.setLife(moment.actor, moment.stops[0].goal)

  return moment
}

/** One step: the hold starts once the person stands at the stop, and the next stop follows when
 *  it ends. `done` after the last; the person goes back to their seat. */
export function stepMoment(
  director: Director,
  moment: Moment,
  at: { readonly actor: ActorState; readonly nowMs: number }
): 'running' | 'done' {
  const stop = moment.stops[moment.index]

  if (stop === undefined) {
    return 'done'
  }

  if (moment.holdUntil === undefined) {
    // The director has taken this stop's goal (the very object) and the person stands where it
    // puts them.
    const isThere = at.actor.goal === stop.goal && at.actor.isSettled && !isWalking(at.actor.walker)

    moment.holdUntil = isThere ? at.nowMs + stop.holdMs : undefined

    return 'running'
  }

  if (at.nowMs < moment.holdUntil) {
    return 'running'
  }

  moment.index++
  moment.holdUntil = undefined

  const next = moment.stops[moment.index]

  if (next === undefined) {
    return 'done'
  }

  director.setLife(moment.actor, next.goal)

  return 'running'
}

/** What the person says now: the stop's own line, else the moment's. */
export function lineOf(moment: Moment): LifeLine | undefined {
  return moment.stops[moment.index]?.line ?? moment.line
}

/** When the hold under way ends, if one is. */
export function momentDueOf(moment: Moment): number {
  return moment.holdUntil ?? Number.POSITIVE_INFINITY
}
