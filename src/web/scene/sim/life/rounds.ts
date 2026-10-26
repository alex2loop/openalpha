import type { ActorState } from '@/web/scene/sim/director'
import type { StopSpec } from '@/web/scene/sim/life/moments'
import type { DeskView, Point, RoomId } from '@/web/scene/types'
import { ASSISTANT } from '@/web/scene/sim/actors/roster'
import { begin } from '@/web/scene/sim/life/schedule'
import { drawBetween, isAtSeat, type LifeState, type LifeStep } from '@/web/scene/sim/life/state'
import { DOORS } from '@/web/scene/world/doors'
import { FLOORS, TEAM_FLOOR } from '@/web/scene/world/floors'
import { roomAt } from '@/web/scene/world/rooms'
import { LIFT_EXITS, TEAM_SEATS } from '@/web/scene/world/seats'
import { MS_PER_MINUTE } from '@/web/text/time-units'

const ROUNDS_IDLE_MS = 25_000
const QUIET_ROUNDS_MINUTES = 25
// In a quiet office the rounds slow from seconds to minutes: the first after this long idle, then
// at most one per as long again, so the page sleeps between them.
const QUIET_ROUNDS_GAP_MS = QUIET_ROUNDS_MINUTES * MS_PER_MINUTE
const ROUND_STOP_MS = Object.freeze({ min: 2_000, max: 4_000 })
// Every this many rounds, one takes the lift up to the own agents' desks.
const LIFT_EVERY = 3
// A door's stop stands this far out from the wall, in the corridor.
const DOOR_STEP_PX = 14
// A desk's stop stands behind its agent's chair, a little to the side.
const DESK_SIDE_PX = 10
const DESK_BACK_PX = 18

/** The rooms' doors along the corridor, west to east: the room each opens on, the stop in the
 *  corridor before it and the opening itself. */
export const ROUND_DOORS: readonly {
  readonly room: RoomId
  readonly at: Point
  readonly door: Point
}[] = Object.freeze(
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

      const opening = { x: door.at.x + door.width / 2, y: door.at.y }

      return room === undefined ? [] : [{ room: room.id, at, door: opening }]
    })
    .sort((a, b) => a.at.x - b.at.x)
)

/** The assistant's rounds: free at its desk for `ROUNDS_IDLE_MS`, it walks the corridor and stops
 *  at each room's door; every third round it then takes the lift to the team floor and stops at
 *  each own agent's desk. Any work, question or approval for it ends the round at once (the step's
 *  freedom check), and it walks back to its desk, by the lift from upstairs. */
export function stepRounds(state: LifeState, step: LifeStep): void {
  const actor = step.actors.get(ASSISTANT)
  const isIdle = actor !== undefined && isRoundFree(actor) && isAtSeat(actor)

  if (!(isIdle && step.canWalk) || state.moments.has(ASSISTANT)) {
    state.round.freeSince = undefined
    return
  }

  state.round.freeSince ??= step.nowMs

  if (step.nowMs < roundDueOf(state, step)) {
    return
  }

  state.round.freeSince = undefined
  state.round.lastAt = step.nowMs
  state.round.count++
  begin(
    state,
    { actor, kind: 'round', nowMs: step.nowMs, line: { actor: ASSISTANT, label: 'rounds' } },
    roundStops(state.round.count, state.teamDesks())
  )
}

/** When a free assistant's round is due: `ROUNDS_IDLE_MS` at its desk, and in a quiet office
 *  also `QUIET_ROUNDS_GAP_MS` since the office's last work and since the last round. */
export function roundDueOf(
  state: LifeState,
  step: { readonly isQuiet: boolean; readonly nowMs: number }
): number {
  const { freeSince, lastAt } = state.round

  if (freeSince === undefined) {
    return Number.POSITIVE_INFINITY
  }

  const atDesk = freeSince + ROUNDS_IDLE_MS

  if (!step.isQuiet) {
    return atDesk
  }

  return Math.max(
    atDesk,
    state.lastBusyAt + QUIET_ROUNDS_GAP_MS,
    (lastAt ?? Number.NEGATIVE_INFINITY) + QUIET_ROUNDS_GAP_MS
  )
}

/** Nothing for it to do: no goal of the live store's, no carry or trip owed, no gesture. */
export function isRoundFree(actor: ActorState): boolean {
  return (actor.goal === undefined || actor.isLife) && !actor.isOwed && actor.beats.length === 0
}

function roundStops(count: number, desks: readonly DeskView[]): readonly [StopSpec, ...StopSpec[]] {
  const doors: StopSpec[] = ROUND_DOORS.map((door, i) => ({
    at: door.at,
    pose: 'idle',
    holdMs: drawBetween(ROUND_STOP_MS, 'round', String(count), String(i)),
    line: { actor: ASSISTANT, label: 'roundCheck', room: door.room },
  }))
  const liftStop: StopSpec = {
    at: LIFT_EXITS.office,
    pose: 'idle',
    holdMs: drawBetween(ROUND_STOP_MS, 'round-lift', String(count)),
  }
  const upstairs = deskStops(count, desks)
  const stops =
    count % LIFT_EVERY === 0 && upstairs.length > 0 ? [...doors, liftStop, ...upstairs] : doors
  const [first, ...rest] = stops

  return first === undefined ? [liftStop] : [first, ...rest]
}

// Each on-duty own agent's desk on the team floor, from the lift and back to it.
function deskStops(count: number, desks: readonly DeskView[]): StopSpec[] {
  const stops: StopSpec[] = desks.flatMap((desk) => {
    const isOnDuty = desk.agentId !== undefined && desk.isTaken
    const seat = isOnDuty ? TEAM_SEATS[desk.slot] : undefined

    return seat === undefined
      ? []
      : [
          {
            at: { x: seat.at.x + DESK_SIDE_PX, y: seat.at.y + DESK_BACK_PX },
            look: seat.at,
            pose: 'idle',
            floor: TEAM_FLOOR,
            holdMs: drawBetween(ROUND_STOP_MS, 'round-desk', String(count), String(desk.slot)),
          },
        ]
  })

  return stops.length === 0
    ? []
    : [
        ...stops,
        {
          at: LIFT_EXITS.team,
          pose: 'idle',
          floor: TEAM_FLOOR,
          holdMs: drawBetween(ROUND_STOP_MS, 'round-lift-up', String(count)),
        },
      ]
}
