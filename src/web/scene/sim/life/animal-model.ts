/** How close the camera is: 0 the whole floor, 1 a room, 2 close up. A part shows from its own
 *  level up. */
export type DetailLevel = 0 | 1 | 2

type AnimalTone = 'fur' | 'shade' | 'light' | 'dark' | 'pink' | 'eye'

/** One box of an animal, in world px from its feet (y grows down, so a body sits at negative y). */
interface AnimalPart {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly tone: AnimalTone
  readonly level: DetailLevel
}

type Box = readonly [number, number, number, number]

// The zoom from which a room's and a close-up's details show.
const ROOM_DETAIL_SCALE = 2.5
const CLOSE_DETAIL_SCALE = 5

/** The fish's tail fin, which beats on its own; it hangs from the body's rear edge. */
export const FISH_TAIL: AnimalPart = part([-4, -1, 1, 3], 'pink')

// The mockup's fish, about eight px nose to tail: the body over its pale belly, the head, then the
// eye and the back fin, and a spot when close.
const FISH_PARTS: readonly AnimalPart[] = Object.freeze([
  part([-3, -1, 5, 2], 'fur'),
  part([-2, 1, 4, 1], 'light'),
  part([2, -1, 2, 2], 'shade'),
  part([3, -1, 1, 1], 'eye', 1),
  part([-1, -2, 2, 1], 'pink', 1),
  part([0, -1, 1, 1], 'dark', 2),
])

/** The fish's colours, for the 3D tank: gold, pale and koi. */
export const ANIMAL_TONES: Readonly<{
  fish: readonly Readonly<Record<AnimalTone, string>>[]
}> = Object.freeze({
  fish: [
    tones(['#FF8B2E', '#F0601E', '#FFD9A8', '#F0601E', '#FF9F45', '#1B1517']),
    tones(['#F7D25B', '#F2C23E', '#FFF3CF', '#F2C23E', '#F9DF86', '#1B1517']),
    tones(['#F8F4EA', '#E0452C', '#FFFFFF', '#2B2433', '#E9E4D6', '#1B1517']),
  ],
})

/** The detail level a zoom (CSS px per world px) draws at. */
export function detailOf(scale: number): DetailLevel {
  if (scale >= CLOSE_DETAIL_SCALE) {
    return 2
  }

  return scale >= ROOM_DETAIL_SCALE ? 1 : 0
}

/** The fish's parts but its tail at `level`. */
export function fishPartsOf(level: DetailLevel): readonly AnimalPart[] {
  return FISH_PARTS.filter((one) => one.level <= level)
}

function part(box: Box, tone: AnimalTone, level: DetailLevel = 0): AnimalPart {
  const [x, y, w, h] = box

  return { x, y, w, h, tone, level }
}

function tones(
  list: readonly [string, string, string, string, string, string]
): Readonly<Record<AnimalTone, string>> {
  const [fur, shade, light, dark, pink, eye] = list

  return Object.freeze({ fur, shade, light, dark, pink, eye })
}
