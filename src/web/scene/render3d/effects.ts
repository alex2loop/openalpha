import type { BufferGeometry, Group } from 'three'

import type { Materials } from '@/web/scene/render3d/lights'
import type { SimView } from '@/web/scene/types'
import { type Box, box, mergeBoxes } from '@/web/scene/render3d/boxes'
import { operatorTrayOf } from '@/web/scene/render3d/desk-dressing'
import {
  beginPool,
  createPool,
  endPool,
  type Pool,
  placeInstance,
  type Shapes,
} from '@/web/scene/render3d/instancing'
import { UNIT_PX } from '@/web/scene/render3d/space'
import { ANIMAL_TONES, type DetailLevel, fishPartsOf } from '@/web/scene/sim/life/animal-model'
import { feedKOf } from '@/web/scene/sim/life/events'
import { METAL, PALETTE, PROP_TONES } from '@/web/scene/sprites/palette'
import { propsOn } from '@/web/scene/world/props'

/** The office life's moving pieces, each kind one instanced mesh: sheets in flight, the tray and
 *  printer stacks, steam, the cart and the fish. */
export interface Effects {
  readonly papers: Pool
  readonly stacks: Pool
  readonly steam: Pool
  readonly cart: Pool
  readonly fish: Pool
  fishShape: { level: DetailLevel; geometry: BufferGeometry }
}

/** What the effects read this frame. */
export interface EffectFrame {
  readonly sim: SimView
  readonly now: number
  readonly level: DetailLevel
  readonly isReduced: boolean
}

const STEAM_TONE = '#FFFFFF'
const BUBBLE_TONE = '#D9EFFB'
const MAX_PAPERS = 12
const MAX_STACK = 16
const MAX_STEAM = 24
const MAX_FISH = 6
const SHEET = Object.freeze({ w: 8, h: 0.6, d: 6 })
const PAPER_ARC_PX = 14
const PAPER_FROM_PX = 18
const TRAY = Object.freeze({ step: 1.4, h: 1.2, cap: 6, w: 10.6, d: 5.6, jog: 0.3 })
const PRINT = Object.freeze({ y: 5.8, step: 0.42, w: 12, d: 6, slide: 5 })
const STEAM_RISE_PX = 6
const STEAM_MS = 900
const BUBBLE_MS = 1_200
const PUFF_PX = 1.4
const CART = Object.freeze({ w: 20, d: 10, h: 10 })
const FISH_DEPTH_PX = 1.5
const FISH_WATER = Object.freeze({ inset: 4, y: 10, depth: 6 })
const OPERATOR_TRAY = operatorTrayOf()
const PRINT_TRAY = propsOn('office').find((prop) => prop.kind === 'tray')
const TANK = propsOn('office').find((prop) => prop.kind === 'tank')
const BREAK_PROPS = [...propsOn('office'), ...propsOn('team')].filter(
  (prop) => prop.kind === 'coffee' || prop.kind === 'cooler'
)
// The fish's shape is built in units already: an instance keeps it at one to one.
const FISH_SIZE: readonly [number, number, number] = [UNIT_PX, UNIT_PX, UNIT_PX]

export function createEffects(shapes: Shapes, materials: Materials, root: Group): Effects {
  const fishGeometry = fishShapeOf(0)
  const effects: Effects = {
    papers: createPool(shapes.box, materials.litI, { cap: MAX_PAPERS }),
    stacks: createPool(shapes.box, materials.litI, { cap: MAX_STACK }),
    steam: createPool(shapes.box, materials.unlitI, { cap: MAX_STEAM }),
    cart: createPool(shapes.box, materials.litI, { cap: PROP_TONES.cups.length + 1 }),
    fish: createPool(fishGeometry, materials.litI, { cap: MAX_FISH }),
    fishShape: { level: 0, geometry: fishGeometry },
  }

  root.add(...pools(effects).map((pool) => pool.mesh))

  return effects
}

/** Rewrites what moved; `isChanged` when a pool was rewritten, `isMoving` while one animates. */
export function syncEffects(
  effects: Effects,
  frame: EffectFrame
): { readonly isChanged: boolean; readonly isMoving: boolean } {
  syncFishShape(effects, frame.level)

  const isChanged = [
    syncPapers(effects.papers, frame),
    syncStacks(effects.stacks, frame),
    syncSteam(effects.steam, frame),
    syncCart(effects.cart, frame),
    syncFish(effects.fish, frame),
  ].some(Boolean)
  const { sim } = frame
  const isFeeding = feedKOf(sim.life, frame.now) < 1

  return { isChanged, isMoving: !frame.isReduced && (isFeeding || sim.papers.length > 0) }
}

export function disposeEffects(effects: Effects): void {
  for (const pool of pools(effects)) {
    pool.mesh.dispose()
  }

  effects.fishShape.geometry.dispose()
}

function pools(effects: Effects): Pool[] {
  return [effects.papers, effects.stacks, effects.steam, effects.cart, effects.fish]
}

function syncPapers(pool: Pool, frame: EffectFrame): boolean {
  const { sim } = frame
  const flying = sim.papers.filter((paper) => paper.floor === sim.floor)

  if (!beginPool(pool, flying.map((paper) => `${paper.k}${paper.prevK}`).join() + sim.alpha)) {
    return false
  }

  for (const paper of flying) {
    const k = paper.prevK + (paper.k - paper.prevK) * sim.alpha

    placeInstance(pool, {
      x: paper.from.x + (paper.to.x - paper.from.x) * k,
      y: PAPER_FROM_PX + Math.sin(k * Math.PI) * PAPER_ARC_PX,
      z: paper.from.y + (paper.to.y - paper.from.y) * k,
      size: [SHEET.w, SHEET.h, SHEET.d],
      color: PALETTE.paper,
    })
  }

  endPool(pool)

  return true
}

// The operator's tray stack on your desk, and the printer's stack with its newest sheet sliding out.
function syncStacks(pool: Pool, frame: EffectFrame): boolean {
  const { sim } = frame
  const isOffice = sim.floor === 'office'
  const tray = isOffice && OPERATOR_TRAY !== undefined ? Math.min(TRAY.cap, sim.tray) : 0
  const sheets = isOffice && PRINT_TRAY !== undefined ? sim.life.sheets : 0
  const feedK = frame.isReduced ? 1 : feedKOf(sim.life, frame.now)

  if (!beginPool(pool, `${tray}|${sheets}|${feedK}`)) {
    return false
  }

  for (let i = 0; i < tray && OPERATOR_TRAY !== undefined; i++) {
    placeInstance(pool, {
      x: OPERATOR_TRAY.x + (i % 2) * TRAY.jog + TRAY.w / 2,
      y: OPERATOR_TRAY.y + i * TRAY.step + TRAY.h / 2,
      z: OPERATOR_TRAY.z + TRAY.d / 2,
      size: [TRAY.w, TRAY.h, TRAY.d],
      color: PALETTE.paper,
    })
  }

  if (PRINT_TRAY !== undefined) {
    const cx = PRINT_TRAY.rect.x + PRINT_TRAY.rect.w / 2
    const cz = PRINT_TRAY.rect.y + PRINT_TRAY.rect.h / 2

    for (let i = 0; i < sheets; i++) {
      const slide = i === sheets - 1 ? (1 - feedK) * PRINT.slide : 0

      placeInstance(pool, {
        x: cx,
        y: PRINT.y + i * PRINT.step,
        z: cz - slide,
        size: [PRINT.w, PRINT.step - 0.05, PRINT.d],
        color: PALETTE.paper,
      })
    }
  }

  endPool(pool)

  return true
}

// Steam curls over a pantry mug, a bubble rises in a cooler; still under reduced motion.
function syncSteam(pool: Pool, frame: EffectFrame): boolean {
  const here = frame.sim.life.steam.filter((one) => one.floor === frame.sim.floor)
  const beat = (kind: 'mug' | 'cooler') =>
    frame.isReduced
      ? 0
      : (frame.now % (kind === 'mug' ? STEAM_MS : BUBBLE_MS)) /
        (kind === 'mug' ? STEAM_MS : BUBBLE_MS)

  if (
    !beginPool(pool, here.map((one) => `${one.at.x}${one.at.y}${beat(one.kind).toFixed(2)}`).join())
  ) {
    return false
  }

  for (const one of here) {
    const prop = BREAK_PROPS.find(
      (each) =>
        each.floor === one.floor &&
        each.draw.x + each.draw.w / 2 === one.at.x &&
        each.draw.y === one.at.y
    )
    const isMug = one.kind === 'mug'
    const k = beat(one.kind)
    // Steam rises over the prop's top; a bubble rises inside the cooler's bottle.
    const y = (prop?.height ?? 0) + (isMug ? STEAM_RISE_PX * k : -STEAM_RISE_PX * (2 - k))
    const z = prop === undefined ? one.at.y : prop.rect.y + prop.rect.h / 2
    const tone = isMug ? STEAM_TONE : BUBBLE_TONE

    placeInstance(pool, { x: one.at.x, y, z, size: [PUFF_PX, PUFF_PX * 1.6, PUFF_PX], color: tone })
    placeInstance(pool, {
      x: one.at.x - 2,
      y: y - 2,
      z,
      size: [PUFF_PX, PUFF_PX, PUFF_PX],
      color: tone,
    })
  }

  endPool(pool)

  return true
}

function syncCart(pool: Pool, frame: EffectFrame): boolean {
  const cart = frame.sim.life.cart?.floor === frame.sim.floor ? frame.sim.life.cart : undefined

  if (!beginPool(pool, cart === undefined ? '' : `${cart.at.x}|${cart.at.y}`)) {
    return false
  }

  if (cart !== undefined) {
    placeInstance(pool, {
      x: cart.at.x,
      y: CART.h / 2,
      z: cart.at.y - CART.d / 2,
      size: [CART.w, CART.h, CART.d],
      color: METAL[1],
    })
    PROP_TONES.cups.forEach((tone, i) => {
      placeInstance(pool, {
        x: cart.at.x - 6 + i * 6,
        y: CART.h + 1.5,
        z: cart.at.y - CART.d / 2,
        size: [3, 3, 3],
        color: tone,
      })
    })
  }

  endPool(pool)

  return true
}

function syncFish(pool: Pool, frame: EffectFrame): boolean {
  const fish = frame.sim.floor === 'office' && TANK !== undefined ? frame.sim.life.fish : []

  if (
    !beginPool(
      pool,
      fish.map((one) => `${one.k}${one.depth}${one.isFlipped}`).join() + frame.level
    ) ||
    TANK === undefined
  ) {
    return false
  }

  const { x, y, w, h } = TANK.rect
  const span = w - FISH_WATER.inset * 2

  fish.forEach((one, i) => {
    placeInstance(pool, {
      x: x + FISH_WATER.inset + one.k * span,
      y: FISH_WATER.y + (1 - one.depth) * FISH_WATER.depth,
      z: y + h / 2,
      size: FISH_SIZE,
      yaw: one.isFlipped ? Math.PI : 0,
      color: ANIMAL_TONES.fish[i % ANIMAL_TONES.fish.length]?.fur ?? PALETTE.paper,
    })
  })
  endPool(pool)

  return true
}

// The fish's own parts as one shape in white and greys, tinted by each fish's colour.
function fishShapeOf(level: DetailLevel): BufferGeometry {
  const grey: Readonly<Record<string, string>> = {
    fur: '#FFFFFF',
    shade: '#CCCCCC',
    light: '#FFFFFF',
    dark: '#333333',
    pink: '#F0D0D0',
    eye: '#222222',
  }
  const boxes: Box[] = fishPartsOf(level).map((part) =>
    box(
      [part.x, -FISH_DEPTH_PX / 2, part.w, FISH_DEPTH_PX, -part.y - part.h, part.h],
      grey[part.tone] ?? '#FFFFFF'
    )
  )

  return mergeBoxes(boxes)
}

function syncFishShape(effects: Effects, level: DetailLevel): void {
  if (effects.fishShape.level === level) {
    return
  }

  effects.fishShape.geometry.dispose()
  effects.fishShape = { level, geometry: fishShapeOf(level) }
  effects.fish.mesh.geometry = effects.fishShape.geometry
  effects.fish.key = ''
}
