import type { Dir, Point } from '@/web/scene/types'
import { DESK_SLOTS } from '@/web/scene/world/floors'

/** Where a person sits or stands at rest: `at` is the chair's own point (a seated figure stands
 *  there), `face` the way it looks, `desk` set when it works at a desk in front of it. */
export interface Seat {
  readonly at: Point
  readonly face: Dir
  readonly desk?: true
  readonly turn?: number
}

type SeatGroup = 'meet' | 'lib' | 'assist'
type StationId = 'store' | 'alerts' | 'lib-board' | 'lib-review' | 'lib-theme'

/** The chairs, by the room they stand in: the meeting table's north row looks at the camera, its
 *  south row and every desk look north. */
export const SEATS: Readonly<Record<SeatGroup, readonly Seat[]>> = Object.freeze({
  meet: [
    { at: { x: 480, y: 120 }, face: 'down' },
    { at: { x: 512, y: 120 }, face: 'down' },
    { at: { x: 544, y: 120 }, face: 'down' },
    { at: { x: 464, y: 172 }, face: 'up' },
    { at: { x: 496, y: 172 }, face: 'up' },
    { at: { x: 528, y: 172 }, face: 'up' },
    { at: { x: 560, y: 172 }, face: 'up' },
  ],
  lib: [
    { at: { x: 196, y: 136 }, face: 'up', desk: true },
    { at: { x: 244, y: 136 }, face: 'up', desk: true },
    { at: { x: 292, y: 136 }, face: 'up', desk: true },
  ],
  assist: [{ at: { x: 384, y: 306 }, face: 'up', desk: true }],
} satisfies Record<SeatGroup, readonly Seat[]>)

/** The standing places of the people who work without a chair: the store's aisle, behind the
 *  alert desk, before the library whiteboard, between the shelves and the desks, and the theme
 *  corner by the card catalogue. */
export const STATIONS: Readonly<Record<StationId, Seat>> = Object.freeze({
  store: { at: { x: 48, y: 156 }, face: 'down' },
  alerts: { at: { x: 230, y: 328 }, face: 'down' },
  'lib-board': { at: { x: 352, y: 110 }, face: 'up' },
  'lib-review': { at: { x: 244, y: 96 }, face: 'down' },
  'lib-theme': { at: { x: 206, y: 173 }, face: 'left' },
} satisfies Record<StationId, Seat>)

/** Where an agent waiting on the operator stands at your desk, nearest first. */
export const DESK_WAIT_SPOTS: Readonly<{ readonly agents: readonly Point[] }> = Object.freeze({
  agents: [
    { x: 596, y: 332 },
    { x: 574, y: 332 },
    { x: 618, y: 318 },
  ],
})

// A team desk's chair stands this far right of and below the desk top's corner.
const DESK_SEAT_DX = 20
const DESK_SEAT_DY = 8

/** The chair at each team desk, by slot: its person faces the desk. */
export const TEAM_SEATS: readonly Seat[] = Object.freeze(
  DESK_SLOTS.map((slot) => ({
    at: { x: slot.x + DESK_SEAT_DX, y: slot.y + DESK_SEAT_DY },
    face: 'up' as const,
    desk: true as const,
  }))
)

/** The lounge bench of four south of the team table, where a child agent sits once the desks are
 *  taken. */
export const LOUNGE_BENCH: readonly Seat[] = Object.freeze(
  [524, 546, 568, 590].map((x) => ({ at: { x, y: 146 }, face: 'up' as const }))
)

/** Places round a seat where children stand once desks and bench are taken. */
export const ROUND_DESK_OFFSETS: readonly Point[] = Object.freeze([
  { x: -20, y: 14 },
  { x: 20, y: 14 },
  { x: -32, y: 2 },
  { x: 32, y: 2 },
  { x: -10, y: 26 },
  { x: 10, y: 26 },
])

/** The two places by the team floor's water cooler, facing each other. */
export const COOLER_SPOTS: readonly [Seat, Seat] = Object.freeze([
  { at: { x: 590, y: 332 }, face: 'right' },
  { at: { x: 624, y: 332 }, face: 'left' },
])

/** Where a person steps out of the team floor's lift. */
export const TEAM_LIFT_EXIT: Point = Object.freeze({ x: 44, y: 262 })

/** The operator's in-tray on your desk, where delivered results land. */
export const TRAY_AT: Point = Object.freeze({ x: 512, y: 300 })
