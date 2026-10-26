import type { PaintScene } from '@/web/scene/render2d/wall-props'
import type { DetailLevel } from '@/web/scene/sim/life/animal-model'
import type { FishView, PetView, Rect } from '@/web/scene/types'
import type { PropDef } from '@/web/scene/world/props'
import { fill, INK } from '@/web/scene/render2d/building'
import { ANIMAL_UNIT, animalSprite, blitAnimal } from '@/web/scene/sprites/animal-sprite'
import { FISH_LOOKS } from '@/web/scene/sprites/fish-shape'
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
// The fish keep this much glass to spare across the tank; one at the top of the water hangs this
// far under its rim, a deep one this much lower; a fish further back hangs a little lower still.
const FISH_EDGE_PX = 1.4
const FISH_TOP_PX = 10
const FISH_DEPTH_PX = 5.6
const FISH_Z_SHARE = 0.3
// A sixteenth-turn count: half a turn faces the fish the other way.
const HALF_TURN = 8
const FISH_KINDS = ['gold', 'pale', 'koi'] as const
const FISH_SWIM = Object.freeze({ gold: { z: -2 }, pale: { z: 1 }, koi: { z: 3 } })
const WALK_STEPS = [0, 1, 0, -1] as const
const STEP_PX = 3
// Where a sleeper's "z" sits over its feet.
const SLEEP_Z = Object.freeze({ cat: { dx: 2, rise: 14 }, corgi: { dx: 8, rise: 15 } })

/** One pet between its last two steps, the mockup's ellipsoid sprite over its shadow; a sleeper
 *  carries its "z". */
export function paintPet(
  g: CanvasRenderingContext2D,
  pet: PetView,
  at: { readonly alpha: number; readonly level: DetailLevel }
): void {
  const x = Math.round(pet.prev.x + (pet.at.x - pet.prev.x) * at.alpha)
  const y = Math.round(pet.prev.y + (pet.at.y - pet.prev.y) * at.alpha)
  const pose = spritePoseOf(pet)
  // A walking pet steps with the ground it covers, so its legs move exactly while it moves.
  const step =
    pose === 'walk' || pet.pose === 'walk'
      ? (WALK_STEPS[Math.floor((x + y) / STEP_PX) % 4] ?? 0)
      : 0

  g.fillStyle = SHADOW
  g.fillRect(x - PET_SHADOW.w / 2, y - 1, PET_SHADOW.w, PET_SHADOW.h)
  blitAnimal(
    g,
    animalSprite({
      kind: pet.kind,
      pose,
      level: at.level,
      motion: { step, yaw: 0, tail: 0 },
      isDim: false,
    }),
    { x, y: y - pet.lift, isFlipped: pet.isFlipped }
  )

  if (pose === 'sleep') {
    paintSleepZ(g, { x: x + SLEEP_Z[pet.kind].dx, y: y - SLEEP_Z[pet.kind].rise - pet.lift })
  }
}

// The mockup's poses: a cat walks, sits or sleeps; a corgi stands (walking too), lies or sleeps.
function spritePoseOf(pet: PetView): string {
  if (pet.kind === 'cat') {
    if (pet.pose === 'walk') {
      return 'walk'
    }

    return pet.pose === 'sleep' || pet.pose === 'lie' ? 'sleep' : 'sit'
  }

  if (pet.pose === 'sleep') {
    return 'sleep'
  }

  return pet.pose === 'walk' || pet.pose === 'stand' ? 'stand' : 'lie'
}

// A "z" over a sleeper: three strokes, so it reads at every zoom.
function paintSleepZ(
  g: CanvasRenderingContext2D,
  at: { readonly x: number; readonly y: number }
): void {
  const { x, y } = at

  fill(g, [x, y, 3, 1], INK)
  fill(g, [x + 2, y + 1, 1, 1], INK)
  fill(g, [x + 1, y + 2, 1, 1], INK)
  fill(g, [x, y + 3, 3, 1], INK)
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
  paintFish(g, { x, y, w, h: 13 }, { fish: scene.life.fish, level: scene.detail, isDim: !isOn })

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

/** The tank's fish inside its water, the mockup's sprites: gold, pale and koi, turned the way they
 *  swim and dimmed with the lamp off. */
function paintFish(
  g: CanvasRenderingContext2D,
  tank: Rect,
  spec: { readonly fish: readonly FishView[]; readonly level: DetailLevel; readonly isDim: boolean }
): void {
  spec.fish.forEach((fish, i) => {
    const kind = FISH_KINDS[i % FISH_KINDS.length] ?? 'gold'
    const look = FISH_SWIM[kind]
    const length = FISH_LOOKS[kind].L * ANIMAL_UNIT
    const span = tank.w - FISH_EDGE_PX - length
    const sprite = animalSprite({
      kind,
      pose: 'swim',
      level: spec.level,
      motion: { step: 0, yaw: fish.isFlipped ? HALF_TURN : 0, tail: 0 },
      isDim: spec.isDim,
    })

    blitAnimal(g, sprite, {
      x: tank.x + FISH_EDGE_PX / 2 + length / 2 + fish.k * span,
      y: tank.y + FISH_TOP_PX - fish.depth * FISH_DEPTH_PX + look.z * FISH_Z_SHARE,
      isFlipped: false,
    })
  })
}
