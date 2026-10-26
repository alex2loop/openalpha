import type { PetKind, PetPose } from '@/web/scene/types'

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

/** The office's animals as one model of parts, poses and detail levels; every renderer builds its
 *  own picture of the same parts. */
const CAT_POSES: Readonly<Record<PetPose, readonly AnimalPart[]>> = Object.freeze({
  sleep: [
    part([-6, -5, 12, 5], 'fur'),
    part([-5, -6, 9, 1], 'fur'),
    part([2, -6, 5, 4], 'fur'),
    part([2, -7, 1, 1], 'fur'),
    part([5, -7, 1, 1], 'fur'),
    part([-7, -2, 5, 2], 'shade'),
    part([-3, -5, 1, 3], 'shade', 1),
    part([4, -4, 2, 1], 'dark', 1),
    part([-4, -1, 7, 1], 'light', 2),
  ],
  sit: [
    part([-3, -7, 6, 7], 'fur'),
    part([-1, -6, 3, 4], 'light', 1),
    part([-3, -11, 7, 5], 'fur'),
    part([-3, -12, 2, 1], 'fur'),
    part([2, -12, 2, 1], 'fur'),
    part([-2, -9, 1, 1], 'eye', 1),
    part([1, -9, 1, 1], 'eye', 1),
    part([0, -8, 1, 1], 'pink', 2),
    part([3, -2, 4, 2], 'shade'),
    part([-2, -1, 4, 1], 'light', 2),
  ],
  walk: [
    part([-6, -6, 11, 4], 'fur'),
    part([4, -9, 5, 4], 'fur'),
    part([4, -10, 1, 1], 'fur'),
    part([7, -10, 1, 1], 'fur'),
    ...[-5, -2, 1, 3].map((x) => part([x, -2, 1, 2], 'shade')),
    part([-8, -9, 2, 4], 'shade'),
    part([7, -8, 1, 1], 'eye', 1),
    part([-2, -6, 1, 2], 'shade', 1),
    part([8, -7, 1, 1], 'pink', 2),
  ],
  stand: [],
  lie: [],
})
const CORGI_STAND: readonly AnimalPart[] = [
  part([-7, -7, 13, 4], 'fur'),
  part([-5, -3, 9, 1], 'light'),
  ...[-6, -3, 1, 4].map((x) => part([x, -3, 2, 3], 'light')),
  part([5, -11, 6, 5], 'fur'),
  part([5, -13, 2, 2], 'fur'),
  part([9, -13, 2, 2], 'fur'),
  part([9, -8, 3, 2], 'light', 1),
  part([11, -8, 1, 1], 'dark', 1),
  part([8, -10, 1, 1], 'eye', 1),
  part([-8, -7, 2, 2], 'fur'),
  part([6, -12, 1, 1], 'pink', 2),
]
const CORGI_LIE: readonly AnimalPart[] = [
  part([-7, -5, 13, 5], 'fur'),
  part([-5, -1, 9, 1], 'light'),
  part([5, -8, 6, 5], 'fur'),
  part([5, -10, 2, 2], 'fur'),
  part([9, -10, 2, 2], 'fur'),
  part([9, -5, 3, 2], 'light', 1),
  part([11, -5, 1, 1], 'dark', 1),
  part([8, -7, 1, 1], 'eye', 1),
  part([-8, -4, 2, 2], 'fur'),
  part([6, -9, 1, 1], 'pink', 2),
]
const CORGI_POSES: Readonly<Record<PetPose, readonly AnimalPart[]>> = Object.freeze({
  sleep: [...CORGI_LIE.filter((one) => one.tone !== 'eye'), part([7, -7, 2, 1], 'dark', 1)],
  sit: CORGI_STAND,
  walk: CORGI_STAND,
  stand: CORGI_STAND,
  lie: CORGI_LIE,
})
const FISH_PARTS: readonly AnimalPart[] = Object.freeze([
  part([-2, -1, 4, 2], 'fur'),
  part([-3, -1, 1, 2], 'shade'),
  part([1, -1, 1, 1], 'eye', 1),
  part([0, 0, 2, 1], 'light', 2),
])

/** The colours of each animal; the three fish each wear their own. */
export const ANIMAL_TONES: Readonly<{
  cat: Readonly<Record<AnimalTone, string>>
  corgi: Readonly<Record<AnimalTone, string>>
  fish: readonly Readonly<Record<AnimalTone, string>>[]
}> = Object.freeze({
  cat: tones(['#E49A4F', '#CF7F36', '#F7DFBB', '#B0622B', '#E89B9B', '#1B1416']),
  corgi: tones(['#CB8841', '#B5743A', '#F5EADB', '#1C1517', '#E9C7A6', '#2A1B17']),
  fish: [
    tones(['#F28C38', '#D96A1E', '#FFF1E0', '#4A2C17', '#F6B7A0', '#1B1416']),
    tones(['#5AAAE9', '#3F86C6', '#E3F3FF', '#1D3A5C', '#BFD9F2', '#101820']),
    tones(['#F2D05A', '#D3AE33', '#FFF8DC', '#5C4A10', '#F6E3A8', '#1B1416']),
  ],
})

/** The detail level a zoom (CSS px per world px) draws at. */
export function detailOf(scale: number): DetailLevel {
  if (scale >= CLOSE_DETAIL_SCALE) {
    return 2
  }

  return scale >= ROOM_DETAIL_SCALE ? 1 : 0
}

/** The parts of a pet in a pose at a detail level; a cat's stand reads as its sit, its lie as its
 *  sleep. */
export function petPartsOf(
  kind: PetKind,
  pose: PetPose,
  level: DetailLevel
): readonly AnimalPart[] {
  const poses = kind === 'cat' ? CAT_POSES : CORGI_POSES
  const own = poses[pose]
  const parts = own.length > 0 ? own : poses[pose === 'stand' ? 'sit' : 'sleep']

  return parts.filter((one) => one.level <= level)
}

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
