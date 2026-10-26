import type { FishView, PetView, Rect } from '@/web/scene/types'
import {
  ANIMAL_TONES,
  type DetailLevel,
  fishPartsOf,
  petPartsOf,
} from '@/web/scene/sim/life/animal-model'
import { SHADOW } from '@/web/scene/sprites/palette'

// The zoom (CSS px per world px) from which a room's and a close-up's details show.
const ROOM_DETAIL_SCALE = 2.5
const CLOSE_DETAIL_SCALE = 5
const PET_SHADOW = Object.freeze({ w: 10, h: 2 })
// The water inside the tank's glass, where the fish swim.
const WATER_INSET = Object.freeze({ x: 4, top: 4, bottom: 4 })

/** The detail level a zoom draws at. */
export function detailOf(scale: number): DetailLevel {
  if (scale >= CLOSE_DETAIL_SCALE) {
    return 2
  }

  return scale >= ROOM_DETAIL_SCALE ? 1 : 0
}

/** One pet between its last two steps, its shadow on the floor under it. */
export function paintPet(
  g: CanvasRenderingContext2D,
  pet: PetView,
  at: { readonly alpha: number; readonly level: DetailLevel }
): void {
  const x = Math.round(pet.prev.x + (pet.at.x - pet.prev.x) * at.alpha)
  const y = Math.round(pet.prev.y + (pet.at.y - pet.prev.y) * at.alpha)
  const lift = Math.round(pet.lift)
  const tones = ANIMAL_TONES[pet.kind]
  const flip = pet.isFlipped ? -1 : 1

  g.fillStyle = SHADOW
  g.fillRect(x - PET_SHADOW.w / 2, y - 1, PET_SHADOW.w, PET_SHADOW.h)

  for (const part of petPartsOf(pet.kind, pet.pose, at.level)) {
    const left = flip === 1 ? part.x : -part.x - part.w

    g.fillStyle = tones[part.tone]
    g.fillRect(x + left, y - lift + part.y, part.w, part.h)
  }
}

/** The tank's fish inside its water. */
export function paintFish(
  g: CanvasRenderingContext2D,
  tank: Rect,
  spec: { readonly fish: readonly FishView[]; readonly level: DetailLevel }
): void {
  const left = tank.x + WATER_INSET.x
  const span = tank.w - WATER_INSET.x * 2
  const top = tank.y + WATER_INSET.top
  const depth = tank.h - WATER_INSET.top - WATER_INSET.bottom

  spec.fish.forEach((fish, i) => {
    const tones = ANIMAL_TONES.fish[i % ANIMAL_TONES.fish.length]
    const x = Math.round(left + fish.k * span)
    const y = Math.round(top + fish.depth * depth)

    if (tones === undefined) {
      return
    }

    for (const part of fishPartsOf(spec.level)) {
      const dx = fish.isFlipped ? -part.x - part.w : part.x

      g.fillStyle = tones[part.tone]
      g.fillRect(x + dx, y + part.y, part.w, part.h)
    }
  })
}
