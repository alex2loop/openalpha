import {
  BoxGeometry,
  type BufferGeometry,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
} from 'three'

import type { ModelPose } from '@/web/scene/render3d/animal-parts'
import type { DetailLevel } from '@/web/scene/sim/life/animal-model'
import type { PetKind, PetPose, PetView, SimView } from '@/web/scene/types'
import { catShape } from '@/web/scene/render3d/animal-cat'
import { corgiShape } from '@/web/scene/render3d/animal-corgi'
import { buildAnimalGeometry } from '@/web/scene/render3d/animal-mesh'
import { toUnits } from '@/web/scene/render3d/space'
import { PET_FLOOR } from '@/web/scene/sim/life/pet-paths'
import { OUTLINE } from '@/web/scene/sprites/palette'

/** The lobby's pets as the mockup's ellipsoid animals, one geometry per pose, detail level and leg
 *  step in use, and the "z z" over a sleeper. */
export interface Pets {
  readonly root: Group
  readonly meshes: Mesh[]
  readonly sleeps: Mesh[]
  readonly shapes: Map<string, BufferGeometry>
  readonly mark: { readonly geometry: BoxGeometry; readonly material: MeshBasicMaterial }
  /** What the pets showed last; unchanged, nothing is rewritten. */
  key: string
}

// The mockup's model is in units a fifth of a world px.
const MODEL_PX = 0.2
// A walking pet steps through these leg swings, one every this many ms.
const STEPS = [0, 1, 0, -1] as const
const STEP_MS: Readonly<Record<PetKind, number>> = Object.freeze({ cat: 120, corgi: 150 })
// The sleeper's "z": a small dark square over its head, shown every other beat.
const SLEEP_MARK = Object.freeze({
  size: [2, 2, 0.4] as const,
  beatMs: 1_800,
  at: { cat: [2, 17, -14], corgi: [8, 18, -15] } as const,
})

export function createPets(): Pets {
  return {
    root: new Group(),
    meshes: [],
    sleeps: [],
    shapes: new Map(),
    mark: {
      geometry: new BoxGeometry(1, 1, 1),
      material: new MeshBasicMaterial({ color: OUTLINE, toneMapped: false }),
    },
    key: '',
  }
}

/** Shows the pets on `floor` between their last two steps; a shape no pet shows any more drops
 *  its geometry. True when a pet moved, turned, changed pose, step or detail. */
export function syncPets(
  pets: Pets,
  frame: {
    readonly sim: SimView
    readonly level: DetailLevel
    readonly material: Material
    readonly now: number
    readonly isReduced: boolean
  }
): boolean {
  const { sim } = frame
  const shown = (sim.floor === PET_FLOOR ? sim.life.pets : []).map((pet) => ({
    pet,
    pose: modelPoseOf(pet),
    step: stepOf(pet, frame),
  }))
  const beat = frame.isReduced ? 0 : Math.floor(frame.now / SLEEP_MARK.beatMs) % 2
  const shownKey = `${frame.level}|${beat}|${shown.map(({ pet, step }) => `${petKeyOf(pet, sim.alpha)}${step}`).join('|')}`

  if (shownKey === pets.key) {
    return false
  }

  pets.key = shownKey

  const used = new Set<string>()

  shown.forEach(({ pet, pose, step }, i) => {
    const key = `${pet.kind}|${pose}|${frame.level}|${step}`
    const mesh = meshAt(pets, i, frame.material)
    const x = pet.prev.x + (pet.at.x - pet.prev.x) * sim.alpha
    const z = pet.prev.y + (pet.at.y - pet.prev.y) * sim.alpha

    used.add(key)
    mesh.geometry = shapeOf(pets, { kind: pet.kind, pose, level: frame.level, step, key })
    mesh.visible = true
    mesh.position.set(toUnits(x), toUnits(pet.lift), toUnits(z))
    mesh.rotation.y = pet.isFlipped ? Math.PI : 0
    placeSleepMark(sleepAt(pets, i), {
      kind: pet.kind,
      x,
      z,
      lift: pet.lift,
      isShown: pose === 'sleep' && beat === 1,
    })
  })

  for (const mesh of [...pets.meshes.slice(shown.length), ...pets.sleeps.slice(shown.length)]) {
    mesh.visible = false
  }

  dropUnused(pets, used)

  return true
}

// A shape no pet shows any more drops its geometry.
function dropUnused(pets: Pets, used: ReadonlySet<string>): void {
  for (const [shapeKey, shape] of pets.shapes) {
    if (!used.has(shapeKey)) {
      shape.dispose()
      pets.shapes.delete(shapeKey)
    }
  }
}

export function disposePets(pets: Pets): void {
  for (const shape of pets.shapes.values()) {
    shape.dispose()
  }

  pets.shapes.clear()
  pets.mark.geometry.dispose()
  pets.mark.material.dispose()
}

// The mockup's cat sits, sleeps or walks; its corgi stands (walking too), lies or sleeps.
function modelPoseOf(pet: PetView): ModelPose {
  const pose: PetPose = pet.pose

  if (pose === 'sleep') {
    return 'sleep'
  }

  if (pet.kind === 'cat') {
    return pose === 'walk' ? 'walk' : 'sit'
  }

  return pose === 'stand' || pose === 'walk' ? 'stand' : 'lie'
}

// A walking pet swings its legs in steps; a still one, or under reduced motion, stands square.
function stepOf(
  pet: PetView,
  frame: { readonly now: number; readonly isReduced: boolean }
): number {
  const isMoving = pet.prev.x !== pet.at.x || pet.prev.y !== pet.at.y

  if (!isMoving || frame.isReduced) {
    return 0
  }

  return STEPS[Math.floor(frame.now / STEP_MS[pet.kind]) % STEPS.length] ?? 0
}

// A walking pet's key carries the frame's step fraction, so each in-between frame is drawn.
function petKeyOf(pet: PetView, alpha: number): string {
  const isMoving = pet.prev.x !== pet.at.x || pet.prev.y !== pet.at.y

  return [
    pet.kind,
    pet.pose,
    pet.at.x,
    pet.at.y,
    pet.lift,
    pet.isFlipped,
    isMoving ? alpha : '',
  ].join()
}

function placeSleepMark(
  mark: Mesh,
  at: {
    readonly kind: PetKind
    readonly x: number
    readonly z: number
    readonly lift: number
    readonly isShown: boolean
  }
): void {
  const [dx, dy, dz] = SLEEP_MARK.at[at.kind]
  const [w, h, d] = SLEEP_MARK.size

  mark.visible = at.isShown
  mark.scale.set(toUnits(w), toUnits(h), toUnits(d))
  mark.position.set(toUnits(at.x + dx), toUnits(at.lift + dy), toUnits(at.z + dz))
}

function meshAt(pets: Pets, index: number, material: Material): Mesh {
  const held = pets.meshes[index]

  if (held !== undefined) {
    return held
  }

  const mesh = new Mesh(undefined, material)

  mesh.scale.setScalar(toUnits(MODEL_PX))
  mesh.castShadow = true
  mesh.receiveShadow = true
  pets.meshes.push(mesh)
  pets.root.add(mesh)

  return mesh
}

function sleepAt(pets: Pets, index: number): Mesh {
  const held = pets.sleeps[index]

  if (held !== undefined) {
    return held
  }

  const mesh = new Mesh(pets.mark.geometry, pets.mark.material)

  pets.sleeps.push(mesh)
  pets.root.add(mesh)

  return mesh
}

function shapeOf(
  pets: Pets,
  spec: {
    readonly kind: PetKind
    readonly pose: ModelPose
    readonly level: DetailLevel
    readonly step: number
    readonly key: string
  }
): BufferGeometry {
  const held = pets.shapes.get(spec.key)

  if (held !== undefined) {
    return held
  }

  const model =
    spec.kind === 'corgi' ? corgiShape(spec.pose, spec.level) : catShape(spec.pose, spec.level)
  const shape = buildAnimalGeometry(model, spec)

  pets.shapes.set(spec.key, shape)

  return shape
}
