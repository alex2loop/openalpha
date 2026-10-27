import type { Dir, FloorId, Point, RoomId } from '@/web/scene/types'
import { DESK_SLOTS, FLOORS } from '@/web/scene/world/floors'

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

/** The building crew's rest places: the receptionist's chair behind the front desk, the guard's
 *  post beside the badge gates, and the lobby bin's side, where the cleaner starts her round. */
export const CREW_POSTS: Readonly<Record<'receptionist' | 'guard' | 'cleaner', Seat>> =
  Object.freeze({
    receptionist: { at: { x: 121, y: 316 }, face: 'down', desk: true },
    guard: { at: { x: 18, y: 268 }, face: 'down' },
    cleaner: { at: { x: 144, y: 305 }, face: 'left' },
  })

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

const OFFICE_LIFT = FLOORS.office.lift
// The office lift's landing stands this far south of its doors.
const OFFICE_LIFT_STEP_PX = 10

/** Where a person steps out of each floor's lift. */
export const LIFT_EXITS: Readonly<Record<FloorId, Point>> = Object.freeze({
  office: {
    x: OFFICE_LIFT.x + OFFICE_LIFT.w / 2,
    y: OFFICE_LIFT.y + OFFICE_LIFT.h + OFFICE_LIFT_STEP_PX,
  },
  team: TEAM_LIFT_EXIT,
} satisfies Record<FloorId, Point>)

/** The operator's in-tray on your desk, where delivered results land and their carrier stands. */
export const TRAY_AT: Point = Object.freeze({ x: 512, y: 300 })
/** The bottom sheet's top-left corner in the tray on your desk; the stack rises from it. */
export const TRAY_STACK: Point = Object.freeze({ x: 520, y: 308 })

/** Each floor's break spot: where a coffee or a dessert is fetched, nearest first, and the dessert
 *  cart's resting place with the path it rolls in on (from the corridor). */
interface Pantry {
  readonly room: RoomId
  readonly spots: readonly Seat[]
  readonly cart: { readonly rest: Point; readonly path: readonly Point[] }
}

export const PANTRY: Readonly<Record<FloorId, Pantry>> = Object.freeze({
  office: {
    room: 'meet',
    spots: [
      { at: { x: 404, y: 168 }, face: 'down' },
      { at: { x: 392, y: 184 }, face: 'up' },
      { at: { x: 436, y: 184 }, face: 'up' },
      { at: { x: 420, y: 196 }, face: 'up' },
    ],
    cart: {
      rest: { x: 432, y: 168 },
      path: [
        { x: 512, y: 198 },
        { x: 512, y: 184 },
        { x: 432, y: 184 },
        { x: 432, y: 168 },
      ],
    },
  },
  team: {
    room: 'team',
    spots: [
      { at: { x: 530, y: 336 }, face: 'up' },
      { at: { x: 550, y: 336 }, face: 'up' },
      { at: { x: 570, y: 336 }, face: 'up' },
      { at: { x: 590, y: 336 }, face: 'up' },
    ],
    cart: {
      rest: { x: 608, y: 338 },
      path: [
        { x: 470, y: 366 },
        { x: 608, y: 366 },
        { x: 608, y: 338 },
      ],
    },
  },
} satisfies Record<FloorId, Pantry>)

/** The two sofa seats of each floor, turned toward each other by `turn`. */
export const SOFA_SEATS: Readonly<Record<FloorId, readonly [Seat, Seat]>> = Object.freeze({
  office: [
    { at: { x: 42, y: 366 }, face: 'down', turn: 0.75 },
    { at: { x: 78, y: 366 }, face: 'down', turn: -0.75 },
  ],
  team: [
    { at: { x: 552, y: 254 }, face: 'down', turn: 0.75 },
    { at: { x: 588, y: 254 }, face: 'down', turn: -0.75 },
  ],
} satisfies Record<FloorId, readonly [Seat, Seat]>)

/** The standing places before the meeting room's whiteboard, for a stand-up. */
export const BOARD_SPOTS: readonly Point[] = Object.freeze([
  { x: 404, y: 104 },
  { x: 422, y: 106 },
  { x: 440, y: 104 },
  { x: 414, y: 116 },
])

// A person within this of a chair's point sits on it.
const SEAT_REACH_PX = 3
const ALL_SEATS: readonly Seat[] = Object.freeze([
  ...SEATS.meet,
  ...SEATS.lib,
  ...SEATS.assist,
  ...TEAM_SEATS,
  ...LOUNGE_BENCH,
  ...SOFA_SEATS.office,
  ...SOFA_SEATS.team,
])

/** The way a desk sitter looks in each view, as the mockup's two cameras show them: the 2D sprite
 *  faces the room over its monitor laid flat, the 3D figure turns its back to the camera and faces
 *  its monitor. */
export const DESK_SITTER_FACE: Readonly<Record<'2d' | '3d', Dir>> = Object.freeze({
  '2d': 'down',
  '3d': 'up',
})

/** The chair someone at `at` sits on, if any. */
export function seatAt(at: Point): Seat | undefined {
  return ALL_SEATS.find((one) => Math.hypot(one.at.x - at.x, one.at.y - at.y) <= SEAT_REACH_PX)
}
