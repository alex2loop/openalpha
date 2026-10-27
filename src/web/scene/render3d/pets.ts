import { BoxGeometry, Group, type Material, Mesh, MeshBasicMaterial } from 'three'

import type { ModelPose } from '@/web/scene/render3d/animal-parts'
import type { PetRig } from '@/web/scene/render3d/pet-rig'
import type { DetailLevel } from '@/web/scene/sim/life/animal-model'
import type { AnimalMotion } from '@/web/scene/sim/life/animal-motion'
import type { PetKind, PetPose, PetView, SimView } from '@/web/scene/types'
import { ambientMsOf } from '@/web/scene/budgets'
import { catShape } from '@/web/scene/render3d/animal-cat'
import { corgiShape } from '@/web/scene/render3d/animal-corgi'
import { createPetRig, disposeRig, poseRig } from '@/web/scene/render3d/pet-rig'
import { toUnits } from '@/web/scene/render3d/space'
import { petMotionOf } from '@/web/scene/sim/life/animal-motion'
import { PET_FLOOR } from '@/web/scene/sim/life/pet-paths'
import { OUTLINE } from '@/web/scene/sprites/palette'

/** The lobby's pets as the mockup's ellipsoid animals, one skinned rig per pose and detail level
 *  in use, and the "z z" over a sleeper. */
export interface Pets {
  readonly root: Group
  readonly rigs: Map<string, PetRig>
  readonly sleeps: Mesh[]
  readonly mark: { readonly geometry: BoxGeometry; readonly material: MeshBasicMaterial }
  /** What the pets showed last; unchanged, nothing is rewritten. */
  key: string
}

// A walking pet steps through these leg swings, one every this many ms.
const STEPS = [0, 1, 0, -1] as const
const STEP_MS: Readonly<Record<PetKind, number>> = Object.freeze({ cat: 120, corgi: 150 })
// The sleeper's "z": a small dark square over its head, up while it rests and every other beat
// while its bout is on.
const SLEEP_MARK = Object.freeze({
  size: [2, 2, 0.4] as const,
  beatMs: 1_800,
  at: { cat: [2, 17, -14], corgi: [8, 18, -15] } as const,
})

/** What a frame shows the pets: the sim, the detail level, the lit material, the clock. */
interface PetFrame {
  readonly sim: SimView
  readonly level: DetailLevel
  readonly material: Material
  readonly now: number
  readonly isReduced: boolean
}

// One pet as drawn this frame.
interface ShownPet {
  readonly pet: PetView
  readonly pose: ModelPose
  readonly motion: AnimalMotion
  readonly isZShown: boolean
}

export function createPets(): Pets {
  return {
    root: new Group(),
    rigs: new Map(),
    sleeps: [],
    mark: {
      geometry: new BoxGeometry(1, 1, 1),
      material: new MeshBasicMaterial({ color: OUTLINE, toneMapped: false }),
    },
    key: '',
  }
}

/** Shows the pets on `floor` between their last two steps, breathing, flicking and wagging on the
 *  ambient clock; a rig no pet shows any more is dropped. True when a pet moved, turned, changed
 *  pose, step or detail. */
export function syncPets(pets: Pets, frame: PetFrame): boolean {
  const { sim } = frame
  const shown = (sim.floor === PET_FLOOR ? sim.life.pets : []).map((pet) => shownOf(pet, frame))
  const shownKey = `${frame.level}|${shown.map((one) => keyOf(one, sim.alpha)).join('|')}`

  if (shownKey === pets.key) {
    return false
  }

  pets.key = shownKey

  const used = new Set<string>()

  shown.forEach((one, i) => {
    const rig = rigFor(pets, one, frame)
    const { pet } = one
    const x = pet.prev.x + (pet.at.x - pet.prev.x) * sim.alpha
    const z = pet.prev.y + (pet.at.y - pet.prev.y) * sim.alpha

    used.add(rigKeyOf(one, frame.level))
    poseRig(rig, pet.kind, one.motion)
    rig.mesh.position.set(toUnits(x), toUnits(pet.lift), toUnits(z))
    rig.mesh.rotation.y = pet.isFlipped ? Math.PI : 0
    placeSleepMark(sleepAt(pets, i), { pet, x, z, isShown: one.isZShown })
  })

  for (const mesh of pets.sleeps.slice(shown.length)) {
    mesh.visible = false
  }

  dropUnused(pets, used)

  return true
}

// A rig no pet shows any more drops its geometry.
function dropUnused(pets: Pets, used: ReadonlySet<string>): void {
  for (const [key, rig] of pets.rigs) {
    if (!used.has(key)) {
      disposeRig(rig)
      pets.rigs.delete(key)
    }
  }
}

export function disposePets(pets: Pets): void {
  for (const rig of pets.rigs.values()) {
    disposeRig(rig)
  }

  pets.rigs.clear()
  pets.mark.geometry.dispose()
  pets.mark.material.dispose()
}

function shownOf(pet: PetView, frame: PetFrame): ShownPet {
  const pose = modelPoseOf(pet)
  const ms = ambientMsOf(frame.now)
  const beat = Math.floor(ms / SLEEP_MARK.beatMs) % 2 === 1

  return {
    pet,
    pose,
    motion: petMotionOf({
      kind: pet.kind,
      pose,
      level: frame.level,
      ms,
      isLive: pet.isLive,
      step: stepOf(pet, frame),
      air: pet.air,
      pitch: pet.pitch,
    }),
    // Under reduced motion no "z" shows, as the mockup's.
    isZShown: pose === 'sleep' && !frame.isReduced && (!pet.isLive || beat),
  }
}

function rigKeyOf(one: ShownPet, level: DetailLevel): string {
  return `${one.pet.kind}|${one.pose}|${level}`
}

function rigFor(pets: Pets, one: ShownPet, frame: PetFrame): PetRig {
  const key = rigKeyOf(one, frame.level)
  const held = pets.rigs.get(key)

  if (held !== undefined) {
    return held
  }

  const model =
    one.pet.kind === 'corgi' ? corgiShape(one.pose, frame.level) : catShape(one.pose, frame.level)
  const rig = createPetRig(model, { level: frame.level, material: frame.material })

  pets.rigs.set(key, rig)
  pets.root.add(rig.mesh)

  return rig
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
function keyOf(one: ShownPet, alpha: number): string {
  const { pet } = one
  const isMoving = pet.prev.x !== pet.at.x || pet.prev.y !== pet.at.y

  return [
    pet.kind,
    pet.pose,
    pet.at.x,
    pet.at.y,
    pet.lift,
    pet.isFlipped,
    isMoving ? alpha : '',
    Object.values(one.motion).join(),
    one.isZShown,
  ].join()
}

function placeSleepMark(
  mark: Mesh,
  at: {
    readonly pet: PetView
    readonly x: number
    readonly z: number
    readonly isShown: boolean
  }
): void {
  const [dx, dy, dz] = SLEEP_MARK.at[at.pet.kind]
  const [w, h, d] = SLEEP_MARK.size

  mark.visible = at.isShown
  mark.scale.set(toUnits(w), toUnits(h), toUnits(d))
  mark.position.set(toUnits(at.x + dx), toUnits(at.pet.lift + dy), toUnits(at.z + dz))
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
