import type { Dir, FloorId, Point, RoomId } from '@/web/scene/types'

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

/** The operator's in-tray on your desk, where delivered results land. */
export const TRAY_AT: Point = Object.freeze({ x: 512, y: 300 })

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
