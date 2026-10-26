import type { SessionPhase } from '@/app/server/wire/vocab'
import type { AgendaRow } from '@/web/scene/data/agenda'
import type { ActorState, Director } from '@/web/scene/sim/director'
import type { Desks } from '@/web/scene/sim/life/desks'
import type { Moment, MomentKind } from '@/web/scene/sim/life/moments'
import type { Pets } from '@/web/scene/sim/life/pets'
import type { RhythmState } from '@/web/scene/sim/life/presence'
import type { ActorId, DeskView, FloorId, Point } from '@/web/scene/types'
import type { OfficeLife } from '@/web/scene/world/regions'
import type { ClockParts } from '@/web/text/time'
import { distance } from '@/web/scene/sim/actors/nav'
import { createRng, seedOf } from '@/web/scene/world/rng'
import { setCapped } from '@/web/state/capped-map'

/** The dessert cart: where it stands, and when it began rolling in or out (a `performance.now()`
 *  instant). */
interface CartState {
  at: Point | undefined
  rollFrom: number | undefined
  isLeaving: boolean
  isBlocking: boolean
}

/** What the wire asked of the office life, waiting for the next step to act on it. */
export type LifeAsk =
  | { readonly kind: 'standup' }
  | { readonly kind: 'finished'; readonly runId: string; readonly outcome: string }

/** Everything the office life keeps between steps. Every map grows only to the roster, a day's
 *  once-only moments, or its own named cap. */
export interface LifeState {
  readonly director: Director
  /** The team floor's desks, which every third round visits. */
  readonly teamDesks: () => readonly DeskView[]
  readonly pets: Pets
  readonly moments: Map<ActorId, Moment>
  readonly done: Map<string, true>
  readonly idleAt: Map<ActorId, number>
  readonly fidgetAt: Map<ActorId, number>
  readonly gaps: Map<string, number>
  readonly mugs: Set<ActorId>
  readonly failed: Set<ActorId>
  readonly verdicts: Map<string, true>
  readonly woken: Map<string, true>
  readonly asks: LifeAsk[]
  readonly runNames: Map<string, string>
  readonly cart: CartState
  readonly desks: Desks
  readonly rhythm: RhythmState
  readonly round: { freeSince: number | undefined; lastAt: number | undefined; count: number }
  sheets: { hour: string; count: number; feedAt: number | undefined }
  catAwakeUntil: number
  lastBusyAt: number
  lastPhase: SessionPhase | undefined
  idleCheckAt: number
}

/** One step's reading of the office: the people, who of them is free with no moment of their
 *  own, the page clock, and what may happen (`canWalk`: not reduced motion, office hours; `isCalm`:
 *  that, and not a quiet office, the first minutes after the open or the closing auction). */
export interface LifeStep {
  readonly nowMs: number
  readonly clock: ClockParts
  readonly actors: ReadonlyMap<ActorId, ActorState>
  readonly free: readonly ActorState[]
  readonly pack: OfficeLife
  readonly canWalk: boolean
  readonly isCalm: boolean
  readonly isQuiet: boolean
  /** After the close, before the office empties: the coffee window opens and chats come sooner. */
  readonly isRelaxed: boolean
  readonly isReduced: boolean
  /** The job each owner runs within `JOB_DUE_MS`. */
  readonly due: ReadonlyMap<ActorId, AgendaRow>
}

// A day's once-only moments, a few each for the roster.
const MAX_DONE = 256
const PERCENT = 100
// A person counts as seated within this of their seat.
const AT_SEAT_PX = 1

/** The person did this moment today already. */
export function isDoneToday(
  state: LifeState,
  at: { actor: ActorId; tag: string; day: string }
): boolean {
  return state.done.has(doneKey(at))
}

export function markDone(state: LifeState, at: { actor: ActorId; tag: string; day: string }): void {
  setCapped(state.done, [doneKey(at), true], MAX_DONE)
}

/** A share of the roster picked for a moment today, the same people all day. */
export function isPicked(
  at: { actor: ActorId; tag: string; day: string },
  percent: number
): boolean {
  return createRng(seedOf(at.actor, at.tag, at.day)).next() * PERCENT < percent
}

/** A draw in [lo, hi] for one decision, keyed by what it decides. */
export function drawBetween(
  range: { readonly min: number; readonly max: number },
  ...parts: readonly string[]
): number {
  return range.min + createRng(seedOf(...parts)).next() * (range.max - range.min)
}

export function isAtSeat(actor: ActorState): boolean {
  return distance(actor.walker.pos, actor.def.seat.at) < AT_SEAT_PX
}

/** The moments under way on a floor, of one kind or of any. */
export function momentsOn(
  state: LifeState,
  at: { readonly step: LifeStep; readonly floor: FloorId; readonly kind?: MomentKind }
): number {
  return [...state.moments.values()].filter((moment) => {
    const actor = at.step.actors.get(moment.actor)

    return actor?.def.floor === at.floor && (at.kind === undefined || moment.kind === at.kind)
  }).length
}

/** The free people standing at their seat, with nothing of the office life under way. */
export function seatedFree(step: LifeStep, floor: FloorId): ActorState[] {
  return step.free.filter((actor) => actor.def.floor === floor && isAtSeat(actor))
}

/** The seat's own pose: seated at a desk, else standing. */
export function seatPoseOf(actor: ActorState): 'sit' | 'idle' {
  return actor.def.seat.desk === true ? 'sit' : 'idle'
}

function doneKey(at: { actor: ActorId; tag: string; day: string }): string {
  return `${at.day}:${at.actor}:${at.tag}`
}
