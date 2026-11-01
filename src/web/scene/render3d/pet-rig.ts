import { Bone, type Material, Skeleton, SkinnedMesh } from 'three'

import type { AnimalPart } from '@/web/scene/render3d/animal-parts'
import type { DetailLevel } from '@/web/scene/sim/life/animal-model'
import type { AnimalMotion } from '@/web/scene/sim/life/animal-motion'
import { buildAnimalGeometry } from '@/web/scene/render3d/animal-mesh'
import { toUnits } from '@/web/scene/render3d/space'
import { partTurnOf } from '@/web/scene/sim/life/animal-motion'

/** One animal in one pose: a skinned mesh over a bone for each part, so it moves by turning
 *  bones and costs one draw call however it moves. */
export interface PetRig {
  readonly mesh: SkinnedMesh
  readonly skeleton: Skeleton
  readonly joints: readonly { readonly part: AnimalPart; readonly bone: Bone }[]
}

// The mockup's model is in units a fifth of a world px.
const MODEL_PX = 0.2
// The mockup's order: a heading about y, then a swing about z.
const TURN_ORDER = 'YZX'

/** The animal's parts bound to their bones at rest; the caller disposes it with `disposeRig`. */
export function createPetRig(
  parts: readonly AnimalPart[],
  spec: { readonly level: DetailLevel; readonly material: Material }
): PetRig {
  const mesh = new SkinnedMesh(buildAnimalGeometry(parts, spec), spec.material)
  const bones = new Map<string, Bone>()
  const joints = parts.map((part) => {
    const bone = new Bone()

    bone.position.set(...part.at)
    bone.rotation.set(0, part.turn[1], part.turn[0], TURN_ORDER)
    const parent = part.parent === undefined ? mesh : bones.get(part.parent)

    parent?.add(bone)
    bones.set(part.name, bone)

    return { part, bone }
  })

  mesh.scale.setScalar(toUnits(MODEL_PX))
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.frustumCulled = false
  mesh.updateMatrixWorld(true)

  const skeleton = new Skeleton(joints.map((joint) => joint.bone))

  mesh.bind(skeleton)

  return { mesh, skeleton, joints }
}

/** Turns each bone as `motion` says, over its rest turn. */
export function poseRig(rig: PetRig, kind: string, motion: AnimalMotion): void {
  for (const { part, bone } of rig.joints) {
    const turn = partTurnOf(kind, part.name, motion)

    bone.rotation.set(0, part.turn[1] + turn.ay, part.turn[0] + turn.az, TURN_ORDER)
    bone.scale.set(1, turn.sy, 1)
  }
}

export function disposeRig(rig: PetRig): void {
  rig.mesh.removeFromParent()
  rig.mesh.geometry.dispose()
  rig.skeleton.dispose()
}
