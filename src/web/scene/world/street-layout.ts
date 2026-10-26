import { WORLD } from '@/web/scene/types'

/** The street's scale: every frontage and speed in metres turns into world px through it. */
export const METRES_PER_PX = 0.5
/** The north street in world y: the far pavement's back edge, the road's far and near kerbs. */
export const NORTH = Object.freeze({ farTop: -30, roadTop: -18, roadBottom: -4.6 })
/** A side street's road, as distances out from the building's side wall. */
export const SIDE_ROAD = Object.freeze({ from: 24, to: 52 })
/** The zebra across the north street, west of the building, and how far before it each way the
 *  cars' stop line and the motorbikes' line stand. */
export const CROSSING = Object.freeze({ x: -14, carLine: 14, bikeLine: 6.4, halfWidth: 4 })
/** Where a side street meets the north street: the room a side vehicle keeps from the north
 *  street's kerb, how far into it a turning vehicle reaches, how deep the junction mouth is, and
 *  how far back the side street's stop line stands. */
export const JUNCTION = Object.freeze({ gap: 2, reach: 2.7, depth: 9, stopLine: 3.5 })
/** Where street furniture stands across the north street: on the far kerb and the near one. */
export const KERB_Y = Object.freeze({ far: NORTH.roadTop - 1.5, near: NORTH.roadBottom + 2.2 })
/** The bus shelters along the north street, by side, in the pack's stop order. */
export const SHELTER_X = Object.freeze({ far: [470, 300, 610], near: [180, 400] })

/** The world x of a point `distance` out from the building's west (-1) or east (1) wall. */
export function sideX(side: -1 | 1, distance: number): number {
  return side < 0 ? -distance : WORLD.w + distance
}
