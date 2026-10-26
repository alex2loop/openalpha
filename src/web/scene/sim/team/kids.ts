import type { Member } from '@/web/scene/sim/team/members'
import type { Point } from '@/web/scene/types'
import { toFreePoint } from '@/web/scene/sim/actors/nav'
import { DESK_SLOTS } from '@/web/scene/world/floors'
import { navGridOf } from '@/web/scene/world/nav-grid'
import {
  LOUNGE_BENCH,
  ROUND_DESK_OFFSETS,
  type Seat,
  TEAM_LIFT_EXIT,
  TEAM_SEATS,
} from '@/web/scene/world/seats'

const TEAM_FLOOR = 'team'
// A new child steps out this far beside its parent, and hands its answer over this far below.
const BESIDE_DX = 14
const BESIDE_DY = 16
const HAND_OVER_DY = 14

/** A place for one child: a desk's seat (with its slot) or a seat with no desk. */
interface KidPlace {
  readonly seat: Seat
  readonly slot?: number
}

/** The seat a new child takes: a free desk (past the first, which waits for a new agent), then the
 *  lounge bench of four, then standing round its parent's seat. */
export function kidPlaceOf(members: readonly Member[], parent: Member | undefined): KidPlace {
  const agentSlots = new Set(
    members.flatMap((member) => (member.kid === undefined ? [member.slot] : []))
  )
  const desks = DESK_SLOTS.flatMap((_, slot) => {
    const seat = TEAM_SEATS[slot]

    return agentSlots.has(slot) || seat === undefined ? [] : [{ seat, slot }]
  }).slice(1)
  const taken = new Set(
    members
      .filter((member) => member.kid !== undefined && member.task !== 'exit')
      .map((member) => keyOf(member.seat.at))
  )
  const around = (parent?.seat ?? LOUNGE_BENCH[0])?.at
  const standing = around === undefined ? [] : roundSeats(around)
  const places: KidPlace[] = [...desks, ...LOUNGE_BENCH.map((seat) => ({ seat })), ...standing]
  const free = places.find((place) => !taken.has(keyOf(place.seat.at)))

  return free ?? places.at(-1) ?? { seat: { at: TEAM_LIFT_EXIT, face: 'down' } }
}

/** Where a new child first stands: beside its parent when the parent is on this floor, else out of
 *  the lift. Odd children step out on the parent's right. */
export function kidEntryOf(parent: Member | undefined, index: number): Point {
  if (parent === undefined) {
    return TEAM_LIFT_EXIT
  }

  const side = index % 2 === 0 ? -1 : 1
  const { pos } = parent.walker

  return toFreePoint(navGridOf(TEAM_FLOOR), {
    x: pos.x + side * BESIDE_DX,
    y: pos.y + BESIDE_DY,
  })
}

/** Where a finished child hands its answer to its parent: just below the parent's seat. */
export function handOverOf(parent: Member): Point {
  const { at } = parent.seat

  return toFreePoint(navGridOf(TEAM_FLOOR), { x: at.x, y: at.y + HAND_OVER_DY })
}

function roundSeats(around: Point): KidPlace[] {
  const grid = navGridOf(TEAM_FLOOR)

  return ROUND_DESK_OFFSETS.map((offset) => ({
    seat: {
      at: toFreePoint(grid, { x: around.x + offset.x, y: around.y + offset.y }),
      face: 'up' as const,
    },
  }))
}

function keyOf(p: Point): string {
  return `${p.x},${p.y}`
}
