import type { ActorState } from '@/web/scene/sim/director'
import type { StopSpec } from '@/web/scene/sim/life/moments'
import type { ActorId, Point, RoomId } from '@/web/scene/types'
import { begin } from '@/web/scene/sim/life/schedule'
import { drawBetween, isAtSeat, type LifeState, type LifeStep } from '@/web/scene/sim/life/state'
import { DOORS } from '@/web/scene/world/doors'
import { FLOORS } from '@/web/scene/world/floors'
import { roomAt } from '@/web/scene/world/rooms'

const ROUNDS_IDLE_MS = 25_000
const ROUND_STOP_MS = Object.freeze({ min: 2_000, max: 4_000 })
// Every this many rounds, one ends at the lift.
const LIFT_EVERY = 3
const ASSISTANT: ActorId = 'assistant'
// A door's stop stands this far out from the wall, in the corridor.
const DOOR_STEP_PX = 14
const LIFT_STEP_PX = 10

/** The rooms' doors along the corridor, west to east, each with the room it opens on. */
const ROUND_DOORS: readonly { readonly room: RoomId; readonly at: Point }[] = Object.freeze(
  DOORS.office
    .flatMap((door) => {
      const corridor = FLOORS.office.corridor

      if (door.to !== undefined || door.isWest === true || corridor === undefined) {
        return []
      }

      const isNorth = door.at.y <= corridor.y
      const room = roomAt('office', {
        x: door.at.x + door.width / 2,
        y: door.at.y + (isNorth ? -1 : 1),
      })
      const at = {
        x: door.at.x + door.width / 2,
        y: door.at.y + (isNorth ? DOOR_STEP_PX : -DOOR_STEP_PX),
      }

      return room === undefined ? [] : [{ room: room.id, at }]
    })
    .sort((a, b) => a.at.x - b.at.x)
)

/** The assistant's rounds: free at its desk for `ROUNDS_IDLE_MS`, it walks the corridor and stops
 *  at each room's door; every third round it ends at the lift. Any work, question or approval for
 *  it ends the round at once (the step's freedom check), and it walks back to its desk. */
export function stepRounds(state: LifeState, step: LifeStep): void {
  const actor = step.actors.get(ASSISTANT)
  const isIdle = actor !== undefined && isRoundFree(actor) && isAtSeat(actor)

  if (!(isIdle && step.canWalk) || state.moments.has(ASSISTANT)) {
    state.round.freeSince = undefined
    return
  }

  state.round.freeSince ??= step.nowMs

  if (step.nowMs - state.round.freeSince < ROUNDS_IDLE_MS) {
    return
  }

  state.round.freeSince = undefined
  state.round.count++
  begin(
    state,
    { actor, kind: 'round', nowMs: step.nowMs, line: { actor: ASSISTANT, label: 'rounds' } },
    roundStops(state.round.count)
  )
}

/** When a free assistant's round is due. */
export function roundDueOf(state: LifeState): number {
  return state.round.freeSince === undefined
    ? Number.POSITIVE_INFINITY
    : state.round.freeSince + ROUNDS_IDLE_MS
}

/** Nothing for it to do: no goal of the live store's, no carry or trip owed, no gesture. */
export function isRoundFree(actor: ActorState): boolean {
  return (actor.goal === undefined || actor.isLife) && !actor.isOwed && actor.beats.length === 0
}

function roundStops(count: number): readonly [StopSpec, ...StopSpec[]] {
  const doors: StopSpec[] = ROUND_DOORS.map((door, i) => ({
    at: door.at,
    pose: 'idle',
    holdMs: drawBetween(ROUND_STOP_MS, 'round', String(count), String(i)),
    line: { actor: ASSISTANT, label: 'roundCheck', room: door.room },
  }))
  const lift = FLOORS.office.lift
  const liftStop: StopSpec = {
    at: { x: lift.x + lift.w / 2, y: lift.y + lift.h + LIFT_STEP_PX },
    pose: 'idle',
    holdMs: drawBetween(ROUND_STOP_MS, 'round-lift', String(count)),
  }
  const stops = count % LIFT_EVERY === 0 ? [...doors, liftStop] : doors
  const [first, ...rest] = stops

  return first === undefined ? [liftStop] : [first, ...rest]
}
