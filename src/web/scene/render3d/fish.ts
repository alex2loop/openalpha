import type { BufferGeometry } from 'three'

import type { Materials } from '@/web/scene/render3d/lights'
import type { FishView, SimView } from '@/web/scene/types'
import { type Box, box, mergeBoxes } from '@/web/scene/render3d/boxes'
import {
  beginPool,
  createPool,
  endPool,
  type Pool,
  placeInstance,
} from '@/web/scene/render3d/instancing'
import { UNIT_PX } from '@/web/scene/render3d/space'
import {
  ANIMAL_TONES,
  type DetailLevel,
  FISH_TAIL,
  fishPartsOf,
} from '@/web/scene/sim/life/animal-model'
import { fishMotionOf, partTurnOf } from '@/web/scene/sim/life/animal-motion'
import { PALETTE } from '@/web/scene/sprites/palette'
import { propsOn } from '@/web/scene/world/props'

/** The tank's fish, each an instance of two pools: the body, and the tail fin that beats on its
 *  hinge. The count of draw calls is fixed; a swim moves instances only. */
export interface Fish {
  readonly body: Pool
  readonly tail: Pool
  shape: {
    readonly level: DetailLevel
    readonly body: BufferGeometry
    readonly tail: BufferGeometry
  }
}

/** What the fish read this frame. */
interface FishFrame {
  readonly sim: SimView
  readonly level: DetailLevel
}

const MAX_FISH = 6
const FISH_DEPTH_PX = 1.5
// The fish keep this much of the tank's width off each end; one at the foot of the water hangs
// this high, one at the top this much higher.
const FISH_WATER = Object.freeze({ inset: 4, y: 10.8, depth: 5.6 })
const TANK = propsOn('office').find((prop) => prop.kind === 'tank')
// The fish's shape is built in units already: an instance keeps it at one to one.
const FISH_SIZE: readonly [number, number, number] = [UNIT_PX, UNIT_PX, UNIT_PX]
const GREY: Readonly<Record<string, string>> & { readonly fur: string } = Object.freeze({
  fur: '#FFFFFF',
  shade: '#CCCCCC',
  light: '#FFFFFF',
  dark: '#333333',
  pink: '#F0D0D0',
  eye: '#222222',
})
const FISH_KIND = 'fish'
type FishPart = typeof FISH_TAIL
const TAIL_HINGE_PX = FISH_TAIL.x + FISH_TAIL.w

export function createFish(materials: Materials): Fish {
  const shape = shapeOf(0)

  return {
    body: createPool(shape.body, materials.litI, { cap: MAX_FISH }),
    tail: createPool(shape.tail, materials.litI, { cap: MAX_FISH }),
    shape,
  }
}

/** Places the fish as the sim says: heading, height and tail's beat. True when they changed. */
export function syncFish(fish: Fish, frame: FishFrame): boolean {
  syncShape(fish, frame.level)

  const views = frame.sim.floor === 'office' && TANK !== undefined ? frame.sim.life.fish : []
  const key = `${frame.level}|${views.map((one) => Object.values(one).join()).join('|')}`

  if (!beginPool(fish.body, key) || TANK === undefined) {
    return false
  }

  beginPool(fish.tail, key)
  views.forEach((view, i) => {
    placeFish(fish, {
      view,
      at: {
        x: TANK.rect.x + FISH_WATER.inset + view.k * (TANK.rect.w - FISH_WATER.inset * 2),
        y: FISH_WATER.y + view.depth * FISH_WATER.depth,
        z: TANK.rect.y + TANK.rect.h / 2,
      },
      color: ANIMAL_TONES.fish[i % ANIMAL_TONES.fish.length]?.fur ?? PALETTE.paper,
    })
  })
  endPool(fish.body)
  endPool(fish.tail)

  return true
}

// The body turns by the fish's heading; the tail fin turns on the body's rear edge, which the
// heading carries round the fish's middle, and beats on from there.
function placeFish(
  fish: Fish,
  one: {
    readonly view: FishView
    readonly at: { readonly x: number; readonly y: number; readonly z: number }
    readonly color: string
  }
): void {
  const motion = fishMotionOf(one.view)
  const heading = partTurnOf(FISH_KIND, 'front', motion).ay
  const beat = partTurnOf(FISH_KIND, 'rear', motion).ay + partTurnOf(FISH_KIND, 'fin', motion).ay
  const { at, color } = one

  placeInstance(fish.body, { ...at, size: FISH_SIZE, yaw: heading, color })
  placeInstance(fish.tail, {
    x: at.x + TAIL_HINGE_PX * Math.cos(heading),
    y: at.y,
    z: at.z - TAIL_HINGE_PX * Math.sin(heading),
    size: FISH_SIZE,
    yaw: heading + beat,
    color,
  })
}

export function disposeFish(fish: Fish): void {
  fish.body.mesh.dispose()
  fish.tail.mesh.dispose()
  fish.shape.body.dispose()
  fish.shape.tail.dispose()
}

function syncShape(fish: Fish, level: DetailLevel): void {
  if (fish.shape.level === level) {
    return
  }

  fish.shape.body.dispose()
  fish.shape.tail.dispose()
  fish.shape = shapeOf(level)
  fish.body.mesh.geometry = fish.shape.body
  fish.tail.mesh.geometry = fish.shape.tail
  fish.body.key = ''
  fish.tail.key = ''
}

// The body's parts as one shape in white and greys, tinted by each fish's colour; the tail fin
// apart, with its hinge at its own origin.
function shapeOf(level: DetailLevel): Fish['shape'] {
  return {
    level,
    body: mergeBoxes(fishPartsOf(level).map((part) => solidOf(part, part.x))),
    tail: mergeBoxes([solidOf(FISH_TAIL, -FISH_TAIL.w)]),
  }
}

function solidOf(part: FishPart, x: number): Box {
  return box(
    [x, -FISH_DEPTH_PX / 2, part.w, FISH_DEPTH_PX, -part.y - part.h, part.h],
    GREY[part.tone] ?? GREY.fur
  )
}
