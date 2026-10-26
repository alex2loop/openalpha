import type { FloorId, Point } from '@/web/scene/types'

/** An opening in a wall: `at` is its first corner, `width` its run along the wall (along y for a
 *  door in the west glass, else along x). The street door is the point outside the west exit where
 *  a walker leaves the floor. */
export interface Door {
  readonly at: Point
  readonly width: number
  readonly to?: 'street' | 'lift'
  readonly isWest?: true
}

/** The point outside the west exit where a walker leaves the office floor for the street. */
export const STREET_DOOR: Point = Object.freeze({ x: -8, y: 266 })

// The lobby's north doorway sits beside the lift (x 130-154), so both read from inside the lobby.
export const DOORS: Readonly<Record<FloorId, readonly Door[]>> = Object.freeze({
  office: [
    { at: { x: 64, y: 192 }, width: 32 },
    { at: { x: 256, y: 192 }, width: 32 },
    { at: { x: 496, y: 192 }, width: 32 },
    { at: { x: 105, y: 224 }, width: 23 },
    { at: { x: 168, y: 224 }, width: 24 },
    { at: { x: 328, y: 224 }, width: 24 },
    { at: { x: 584, y: 224 }, width: 24 },
    { at: { x: 0, y: 254 }, width: 28, isWest: true },
    { at: STREET_DOOR, width: 0, to: 'street' },
    { at: { x: 130, y: 256 }, width: 24, to: 'lift' },
  ],
  team: [
    { at: { x: 0, y: 250 }, width: 32, isWest: true },
    { at: { x: 32, y: 250 }, width: 24, to: 'lift' },
  ],
} satisfies Record<FloorId, readonly Door[]>)
