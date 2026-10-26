import { Group, Mesh, type MeshToonMaterial, type Object3D } from 'three'

import type { HeldKind } from '@/web/scene/sim/actors/poses'
import { createBake, type Kit } from '@/web/scene/render3d/bake'
import { HELD_TONES, PALETTE } from '@/web/scene/sprites/palette'

/** What a person's right hand shows now. */
export interface HeldState {
  readonly key: string
  readonly mesh?: Mesh
}

type Shape = (bake: ReturnType<typeof createBake>, tones: readonly [string, string]) => void

// The hand's centre on the right forearm, in rig units.
const HELD_AT: readonly [number, number, number] = [0, -0.265, 0]
const HELD_SHAPES: Readonly<Record<HeldKind, Shape>> = Object.freeze({
  cup: (b, [body, band]) => {
    b.cylinder([0, -0.02, 0.12], [0.085, 0.065, 0.24], body)
    b.cylinder([0, -0.04, 0.12], [0.092, 0.076, 0.09], band)
    b.cylinder([0, 0.12, 0.12], [0.095, 0.095, 0.035], PALETTE.cupRim)
  },
  bag: (b, [body, band]) => {
    b.round([0, -0.2, 0.04], [0.3, 0.34, 0.15, 0.04], body)
    b.round([0, -0.06, 0.04], [0.3, 0.06, 0.156, 0.02], band)
  },
  box: (b, [body, band]) => {
    b.round([0, 0.02, 0.2], [0.34, 0.1, 0.34, 0.02], body)
    b.round([0, 0.025, 0.2], [0.07, 0.105, 0.346, 0.01], band)
  },
  item: (b, [body, band]) => {
    b.round([0, -0.05, 0.1], [0.12, 0.18, 0.04, 0.02], body)
    b.round([0, -0.02, 0.122], [0.09, 0.1, 0.006, 0.003], band)
  },
})

/** Swaps what hangs from the right forearm when it changes, and keeps it upright however the
 *  arm swings; the old piece's geometry goes with it. */
export function syncHeld(
  held: HeldState,
  spec: {
    readonly hold: HeldKind | undefined
    readonly hand: Object3D
    readonly arm: Object3D
    readonly cast: { readonly kit: Kit; readonly toon: MeshToonMaterial }
  }
): HeldState {
  const key = spec.hold ?? ''
  let next = held

  if (held.key !== key) {
    releaseHeld(held, spec.hand)
    next = { key, ...(spec.hold === undefined ? {} : { mesh: heldMesh(spec.hold, spec.cast) }) }

    if (next.mesh !== undefined) {
      spec.hand.add(next.mesh)
    }
  }

  next.mesh?.rotation.set(-(spec.arm.rotation.x + spec.hand.rotation.x), 0, 0)

  return next
}

export function releaseHeld(held: HeldState, hand: Object3D | undefined): void {
  if (held.mesh !== undefined) {
    hand?.remove(held.mesh)
    held.mesh.geometry.dispose()
  }
}

function heldMesh(
  hold: HeldKind,
  cast: { readonly kit: Kit; readonly toon: MeshToonMaterial }
): Mesh {
  const holder = new Group()
  const bake = createBake(cast.kit, holder)
  const [body, band] = HELD_TONES[hold]

  bake.at(holder, 0)
  HELD_SHAPES[hold](bake, [body, band])

  const mesh = new Mesh(bake.done(false), cast.toon)

  mesh.position.set(...HELD_AT)

  return mesh
}
