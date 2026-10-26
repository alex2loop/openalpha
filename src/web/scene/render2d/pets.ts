import type { PaintScene } from '@/web/scene/render2d/wall-props'
import type { FishView, PetView, Rect } from '@/web/scene/types'
import type { PropDef } from '@/web/scene/world/props'
import { fill, INK } from '@/web/scene/render2d/building'
import {
  ANIMAL_TONES,
  type DetailLevel,
  fishPartsOf,
  petPartsOf,
} from '@/web/scene/sim/life/animal-model'
import { DARKWOOD, SHADOW } from '@/web/scene/sprites/palette'

const PET_SHADOW = Object.freeze({ w: 10, h: 2 })
// The tank's water starts this far under its drawn box's top, below the hood.
const TANK_GLASS_TOP = 3
// A bubble climbs a px each this many ms while a run works.
const BUBBLE_RISE_MS = 160
const TANK_TONES = Object.freeze({
  knob: '#C9A878',
  glare: 'rgba(255,255,255,.16)',
  bubble: 'rgba(255,255,255,.8)',
  on: {
    water: '#BFE6F5',
    hood: '#FFF7C2',
    sand: '#E6D3A3',
    weed: '#4FA373',
    weedDark: '#3F9163',
    stone: '#A9A6B8',
  },
  off: {
    water: '#5E8399',
    hood: '#7A7F8C',
    sand: '#9C8E6E',
    weed: '#2F6B4E',
    weedDark: '#2F6B4E',
    stone: '#6E6C80',
  },
})
// The water inside the tank's glass, where the fish swim.
const WATER_INSET = Object.freeze({ x: 4, top: 3, bottom: 3 })

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

// The mockup's tank on its stand: lit water, the hood light and the sand while the room's lamp is
// on, dim otherwise; the weeds, a stone and the fish inside.
export function paintTank(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, w } = prop.draw
  const y = prop.draw.y + TANK_GLASS_TOP
  const isOn = scene.lit.has(prop.room)
  const look = isOn ? TANK_TONES.on : TANK_TONES.off

  fill(g, [x - 1, y + 14, w + 2, 9], INK)
  fill(g, [x, y + 15, w, 7], DARKWOOD[1])
  fill(g, [x, y + 14, w, 2], DARKWOOD[2])
  fill(g, [x + w / 2 - 1, y + 18, 2, 3], TANK_TONES.knob)
  fill(g, [x - 1, y - 3, w + 2, 17], INK)
  fill(g, [x, y, w, 13], look.water)
  fill(g, [x, y - 2, w, 2], look.hood)
  fill(g, [x, y + 11, w, 2], look.sand)
  fill(g, [x + 7, y + 4, 1, 7], look.weed)
  fill(g, [x + 8, y + 6, 1, 3], look.weed)
  fill(g, [x + 25, y + 6, 1, 5], look.weedDark)
  fill(g, [x + 17, y + 9, 3, 2], look.stone)
  paintFish(g, { x, y, w, h: 13 }, { fish: scene.life.fish, level: scene.detail })

  if (scene.fx?.bubbles === true) {
    for (let i = 0; i < 2; i++) {
      const rise = Math.floor((scene.fx.ms / BUBBLE_RISE_MS + i * 5) % 10)

      fill(g, [x + w - 6 + i * 2, y + 10 - rise, 1, 1], TANK_TONES.bubble)
    }
  }

  if (isOn) {
    fill(g, [x, y, w, 13], TANK_TONES.glare)
  }
}

/** The tank's fish inside its water. */
function paintFish(
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
