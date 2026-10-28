import type { ActorState } from '@/web/scene/sim/director'
import type { Goal } from '@/web/scene/sim/vocabulary'
import type { ActorId, LifeLine, PoseId } from '@/web/scene/types'
import { fidgetPoseOf } from '@/web/scene/sim/actors/poses'
import { isWalking } from '@/web/scene/sim/actors/walk'
import { AMBIENT_KEY, ambientWindows } from '@/web/scene/sim/ambient-windows'
import {
  drawBetween,
  isAtSeat,
  isPicked,
  type LifeState,
  type LifeStep,
  seatPoseOf,
} from '@/web/scene/sim/life/state'
import { isOnErrand } from '@/web/scene/sim/street/errands'
import { SEAT_TARGET } from '@/web/scene/sim/vocabulary'
import { isInRange } from '@/web/scene/world/regions'
import { seedOf } from '@/web/scene/world/rng'

const NAP_PICK_PERCENT = 75
const FIDGET_PERIOD_MS = Object.freeze({ min: 30_000, max: 60_000 })
const FIDGET_HOLD_MS = Object.freeze({ min: 2_000, max: 4_000 })

/** What a person at their seat does with no moment under way: sit up for a job about to run, nap
 *  over lunch, lean back in a quiet office, or keep the mug they came back with. */
export function stepPostures(state: LifeState, step: LifeStep): void {
  const free = new Set(step.free.map((actor) => actor.def.id))

  for (const actor of step.actors.values()) {
    // A gesture plays over the posture and leaves it as it was; a moment, an errand or a way
    // through the street door keeps its own goal.
    const isOwnGoal =
      state.moments.has(actor.def.id) ||
      isOnErrand(state.director.errands, actor.def.id) ||
      state.director.away.has(actor.def.id)

    if (!isOwnGoal && actor.beats.length === 0) {
      state.director.setLife(
        actor.def.id,
        postureOf(state, step, { actor, isFree: free.has(actor.def.id) })
      )
    }
  }
}

/** The line a seated posture says: the job about to run, or the lunch break. */
export function postureLineOf(step: LifeStep, actor: ActorState): LifeLine | undefined {
  const row = step.due.get(actor.def.id)

  if (row !== undefined) {
    return { actor: actor.def.id, label: 'due', time: row.time, what: row.label }
  }

  return actor.isLife && actor.goal?.pose === 'nap'
    ? { actor: actor.def.id, label: 'lunch' }
    : undefined
}

function postureOf(
  state: LifeState,
  step: LifeStep,
  at: { readonly actor: ActorState; readonly isFree: boolean }
): Goal | undefined {
  const { actor } = at
  const id = actor.def.id
  const isUnheld = (actor.goal === undefined || actor.isLife) && !actor.isOwed

  if (isUnheld && step.due.has(id)) {
    return seatGoal({ pose: 'sit-up', sinceMs: step.nowMs })
  }

  if (!at.isFree) {
    return state.mugs.has(id)
      ? seatGoal({ pose: seatPoseOf(actor), sinceMs: step.nowMs, hasCup: true })
      : undefined
  }

  const isNap =
    actor.hasChair &&
    isInRange(step.clock.minute, step.pack.nap) &&
    isPicked({ actor: id, tag: 'nap', day: step.clock.day }, NAP_PICK_PERCENT)

  if (isNap) {
    return seatGoal({ pose: 'nap', sinceMs: step.nowMs })
  }

  if (step.isQuiet) {
    return seatGoal({ pose: 'lean-back', sinceMs: step.nowMs })
  }

  return state.mugs.has(id)
    ? seatGoal({ pose: seatPoseOf(actor), sinceMs: step.nowMs, hasCup: true })
    : undefined
}

function seatGoal(spec: {
  readonly pose: PoseId
  readonly sinceMs: number
  readonly hasCup?: true
}): Goal {
  return {
    kind: 'life',
    target: SEAT_TARGET,
    pose: spec.pose,
    since: spec.sinceMs,
    ...(spec.hasCup === undefined ? {} : { item: 'cup' }),
  }
}

/** Each free person fidgets at their own pace, but only inside the people's ambient window: a
 *  glance aside, a look down, hands behind the head, never while walking, nor in a quiet office. */
export function stepFidgets(state: LifeState, step: LifeStep): void {
  if (step.isReduced || step.isQuiet) {
    return
  }

  for (const actor of step.free) {
    const id = actor.def.id
    const isStill = actor.isSettled && !isWalking(actor.walker) && isAtSeat(actor)
    const isPosed = actor.isLife && actor.goal?.pose === 'nap'

    if (!isStill || isPosed || step.nowMs < fidgetDueOf(state, id, step.nowMs)) {
      continue
    }

    const periodMs = drawBetween(FIDGET_PERIOD_MS, 'fidget', id)
    const slot = String(Math.floor(step.nowMs / periodMs))

    state.fidgetAt.set(id, step.nowMs + periodMs)
    state.director.play(id, {
      pose: fidgetPoseOf(seedOf('fidget', id, slot)),
      ms: drawBetween(FIDGET_HOLD_MS, 'fidget-hold', id, slot),
    })
  }
}

/** When a person's next fidget is due: their own pace, held back to the next time the people's
 *  window is open; the first comes a share of their own period from now. */
export function fidgetDueOf(state: LifeState, id: ActorId, nowMs: number): number {
  const held = state.fidgetAt.get(id)

  if (held !== undefined) {
    return ambientWindows.opensAt(AMBIENT_KEY.people, nowMs, held)
  }

  const due = nowMs + drawBetween(FIDGET_PERIOD_MS, 'fidget-first', id)

  state.fidgetAt.set(id, due)

  return ambientWindows.opensAt(AMBIENT_KEY.people, nowMs, due)
}
