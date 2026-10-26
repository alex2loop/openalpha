import { type BufferGeometry, Group, type Material, Mesh } from 'three'

import type { FloorId, LifeView, PetKind, PetPose } from '@/web/scene/types'
import { type Box, box, mergeBoxes } from '@/web/scene/render3d/boxes'
import { toUnits } from '@/web/scene/render3d/space'
import { ANIMAL_TONES, type DetailLevel, petPartsOf } from '@/web/scene/sim/life/animal-model'
import { PET_FLOOR } from '@/web/scene/sim/life/pet-paths'

/** The lobby's pets as meshes, one geometry per pose and detail level in use. */
export interface Pets {
  readonly root: Group
  readonly meshes: Mesh[]
  readonly shapes: Map<string, BufferGeometry>
}

// How deep each animal's body is, across its side view.
const DEPTH_PX: Readonly<Record<PetKind, number>> = Object.freeze({ cat: 6, corgi: 8 })

export function createPets(): Pets {
  return { root: new Group(), meshes: [], shapes: new Map() }
}

/** Shows the pets on `floor` between their last two steps; a pose that no pet shows any more
 *  drops its geometry. */
export function syncPets(
  pets: Pets,
  life: LifeView,
  frame: {
    readonly floor: FloorId
    readonly alpha: number
    readonly level: DetailLevel
    readonly material: Material
  }
): void {
  const shown = frame.floor === PET_FLOOR ? life.pets : []
  const used = new Set<string>()

  shown.forEach((pet, i) => {
    const key = `${pet.kind}|${pet.pose}|${frame.level}`
    const mesh = meshAt(pets, i, frame.material)

    used.add(key)
    mesh.geometry = shapeOf(pets, { kind: pet.kind, pose: pet.pose, level: frame.level, key })
    mesh.visible = true
    mesh.position.set(
      toUnits(pet.prev.x + (pet.at.x - pet.prev.x) * frame.alpha),
      toUnits(pet.lift),
      toUnits(pet.prev.y + (pet.at.y - pet.prev.y) * frame.alpha)
    )
    mesh.scale.x = pet.isFlipped ? -1 : 1
  })

  for (const mesh of pets.meshes.slice(shown.length)) {
    mesh.visible = false
  }

  for (const [key, shape] of pets.shapes) {
    if (!used.has(key)) {
      shape.dispose()
      pets.shapes.delete(key)
    }
  }
}

export function disposePets(pets: Pets): void {
  for (const shape of pets.shapes.values()) {
    shape.dispose()
  }

  pets.shapes.clear()
}

function meshAt(pets: Pets, index: number, material: Material): Mesh {
  const held = pets.meshes[index]

  if (held !== undefined) {
    return held
  }

  const mesh = new Mesh(undefined, material)

  pets.meshes.push(mesh)
  pets.root.add(mesh)

  return mesh
}

// The model's side-view boxes (x along the body, y up from the feet) stood up across the depth.
function shapeOf(
  pets: Pets,
  spec: {
    readonly kind: PetKind
    readonly pose: PetPose
    readonly level: DetailLevel
    readonly key: string
  }
): BufferGeometry {
  const held = pets.shapes.get(spec.key)

  if (held !== undefined) {
    return held
  }

  const depth = DEPTH_PX[spec.kind]
  const tones = ANIMAL_TONES[spec.kind]
  const boxes: Box[] = petPartsOf(spec.kind, spec.pose, spec.level).map((part) => {
    const isFace = part.tone === 'eye' || part.tone === 'pink' || part.tone === 'dark'
    const d = isFace ? 0.4 : depth

    return box(
      [part.x, isFace ? depth / 2 : -depth / 2, part.w, d, -part.y - part.h, part.h],
      tones[part.tone],
      !isFace
    )
  })
  const shape = mergeBoxes(boxes)

  pets.shapes.set(spec.key, shape)

  return shape
}
