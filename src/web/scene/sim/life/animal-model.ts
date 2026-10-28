/** How close the camera is: 0 the whole floor, 1 a room, 2 close up. A part shows from its own
 *  level up. */
export type DetailLevel = 0 | 1 | 2

// The zoom from which a room's and a close-up's details show.
const ROOM_DETAIL_SCALE = 2.5
const CLOSE_DETAIL_SCALE = 5

/** The detail level a zoom (CSS px per world px) draws at. */
export function detailOf(scale: number): DetailLevel {
  if (scale >= CLOSE_DETAIL_SCALE) {
    return 2
  }

  return scale >= ROOM_DETAIL_SCALE ? 1 : 0
}
