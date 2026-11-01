import { BoxGeometry, Group, type Material, Mesh, MeshBasicMaterial } from 'three'

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
 *  bones. The water and the lid's light over them follow the room's lamp. */
export interface Fish {
  readonly root: Group
  readonly material: Material
  readonly water: Mesh<BoxGeometry, MeshBasicMaterial>
  readonly strip: Mesh<BoxGeometry, MeshBasicMaterial>
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
// The mockup's water: an unlit blue box, see-through, that writes no depth so the fish show; kept
// out of tone mapping so it reads the 2D tank's blue over the sand. The lid's light strip sits at
// the back. Each dims with the room's lamp.
const WATER = Object.freeze({
  inset: 0.1,
  y: 8.8,
  h: 8.6,
  opacity: 0.5,
  on: '#8CCBEA',
  off: '#4E7690',
})
const STRIP = Object.freeze({
  inset: 2.5,
  y: 17.1,
  h: 0.4,
  dz: 1.6,
  d: 1.2,
  on: '#FFF7C2',
  off: '#7A7F8C',
})

export function createFish(material: Material): Fish {
  const root = new Group()
  const water = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshBasicMaterial({
      transparent: true,
      opacity: WATER.opacity,
      depthWrite: false,
      toneMapped: false,
    })
  )
  const strip = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ toneMapped: false }))

  placeTank(water, strip)
  root.add(water, strip)

  return {
    root,
    material,
    water,
    strip,
    rigs: rigsOf(root, { material, level: 0 }),
    level: 0,
    key: '',
  }
}

/** Poses the fish as the sim says: heading, height and tail's beat. True when they changed. */
export function syncFish(fish: Fish, frame: FishFrame): boolean {
  const isShown = frame.sim.floor === 'office' && TANK !== undefined
  const views = isShown ? frame.sim.life.fish : []
  const isOn = TANK !== undefined && frame.sim.props.lit.has(TANK.room)
  const key = `${frame.level}|${isShown}|${isOn}|${views.map((one) => Object.values(one).join()).join('|')}`

  if (key === fish.key) {
    return false
  }

  fish.key = key
  fish.water.visible = isShown
  fish.strip.visible = isShown
  fish.water.material.color.set(isOn ? WATER.on : WATER.off)
  fish.strip.material.color.set(isOn ? STRIP.on : STRIP.off)

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

  for (const mesh of [fish.water, fish.strip]) {
    mesh.geometry.dispose()
    mesh.material.dispose()
  }

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

function placeTank(water: Mesh, strip: Mesh): void {
  if (TANK === undefined) {
    return
  }

  const { x, y, w, h } = TANK.rect

  water.scale.set(toUnits(w - WATER.inset * 2), toUnits(WATER.h), toUnits(h - WATER.inset * 2))
  water.position.set(toUnits(x + w / 2), toUnits(WATER.y + WATER.h / 2), toUnits(y + h / 2))
  strip.scale.set(toUnits(w - STRIP.inset * 2), toUnits(STRIP.h), toUnits(STRIP.d))
  strip.position.set(toUnits(x + w / 2), toUnits(STRIP.y), toUnits(y + STRIP.dz))
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
