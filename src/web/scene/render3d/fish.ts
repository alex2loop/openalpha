import { Group, type Material } from 'three'

import type { PetRig } from '@/web/scene/render3d/pet-rig'
import type { DetailLevel } from '@/web/scene/sim/life/animal-model'
import type { FishView, SimView } from '@/web/scene/types'
import { FISH_KINDS, fishShape } from '@/web/scene/render3d/animal-fish'
import { createPetRig, disposeRig, poseRig } from '@/web/scene/render3d/pet-rig'
import { toUnits } from '@/web/scene/render3d/space'
import { fishMotionOf } from '@/web/scene/sim/life/animal-motion'
import { propsOn } from '@/web/scene/world/props'

/** The tank's fish, one skinned rig each: a heading turns the front, and a beat swings the rear
 *  and the tail fin hung from it. The draw calls are fixed at one a fish; a swim only turns
 *  bones. */
export interface Fish {
  readonly root: Group
  readonly material: Material
  rigs: readonly PetRig[]
  level: DetailLevel
  /** What the fish showed last; unchanged, nothing is rewritten. */
  key: string
}

/** What the fish read this frame. */
interface FishFrame {
  readonly sim: SimView
  readonly level: DetailLevel
}

// The fish keep this much of the tank's width off each end; one at the foot of the water hangs
// this high, one at the top this much higher.
const FISH_WATER = Object.freeze({ inset: 4, y: 10.8, depth: 5.6 })
// How far each fish swims in front of or behind the middle of the tank.
const FISH_LANE_PX: readonly number[] = Object.freeze([-2, 1, 3])
const TANK = propsOn('office').find((prop) => prop.kind === 'tank')
const FISH_PART_KIND = 'fish'

export function createFish(material: Material): Fish {
  const root = new Group()

  return { root, material, rigs: rigsOf(root, { material, level: 0 }), level: 0, key: '' }
}

/** Poses the fish as the sim says: heading, height and tail's beat. True when they changed. */
export function syncFish(fish: Fish, frame: FishFrame): boolean {
  const views = frame.sim.floor === 'office' && TANK !== undefined ? frame.sim.life.fish : []
  const key = `${frame.level}|${views.map((one) => Object.values(one).join()).join('|')}`

  if (key === fish.key) {
    return false
  }

  fish.key = key

  if (fish.level !== frame.level) {
    dropRigs(fish.rigs)
    fish.level = frame.level
    fish.rigs = rigsOf(fish.root, { material: fish.material, level: frame.level })
  }

  for (const [i, rig] of fish.rigs.entries()) {
    placeFish(rig, { view: views[i], lane: FISH_LANE_PX[i] ?? 0 })
  }

  return true
}

export function disposeFish(fish: Fish): void {
  dropRigs(fish.rigs)
  fish.root.removeFromParent()
}

function placeFish(
  rig: PetRig,
  one: { readonly view: FishView | undefined; readonly lane: number }
): void {
  const { view } = one

  rig.mesh.visible = view !== undefined && TANK !== undefined

  if (view === undefined || TANK === undefined) {
    return
  }

  poseRig(rig, FISH_PART_KIND, fishMotionOf(view))
  rig.mesh.position.set(
    toUnits(TANK.rect.x + FISH_WATER.inset + view.k * (TANK.rect.w - FISH_WATER.inset * 2)),
    toUnits(FISH_WATER.y + view.depth * FISH_WATER.depth),
    toUnits(TANK.rect.y + TANK.rect.h / 2 + one.lane)
  )
}

function rigsOf(
  root: Group,
  spec: { readonly material: Material; readonly level: DetailLevel }
): PetRig[] {
  return FISH_KINDS.map((kind) => {
    const rig = createPetRig(fishShape(kind, spec.level), spec)

    rig.mesh.visible = false
    root.add(rig.mesh)

    return rig
  })
}

function dropRigs(rigs: readonly PetRig[]): void {
  for (const rig of rigs) {
    disposeRig(rig)
  }
}
