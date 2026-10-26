import { Group, Mesh, type MeshToonMaterial, type Object3D } from 'three'

import type { HeldKind, InHand } from '@/web/scene/sim/actors/poses'
import { type Bake, createBake, type Kit } from '@/web/scene/render3d/bake'
import { HELD_TONES, PALETTE, PHONE_FINISHES, stampToneOf } from '@/web/scene/sprites/palette'

/** What a person's right hand shows now. */
export interface HeldState {
  readonly key: string
  readonly mesh?: Mesh
}

type Shape = (bake: Bake, tones: readonly [string, string]) => void

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
// A phone: its body, then its face toward the room, the lit screen when read or the back plate
// at the ear.
const PHONE = Object.freeze({
  body: [0, -0.06, 0.1, 0.13, 0.26, 0.03, 0.02],
  edge: [0, 0.066, 0.1, 0.134, 0.012, 0.034, 0.005],
  screen: [0, -0.06, 0.116, 0.11, 0.23, 0.004, 0.002],
  text: [0, -0.02, 0.119, 0.07, 0.014, 0.002, 0.001],
  plate: [0, 0.02, 0.117, 0.11, 0.07, 0.006, 0.003],
} as const)
// A sheet held up from the hand, and where its stamp lands.
const SHEET = Object.freeze({
  page: [0, -0.12, 0.06, 0.2, 0.27, 0.012, 0.004],
  stamp: [0.04, -0.2, 0.068, 0.07, 0.05, 0.004, 0.002],
} as const)

/** Swaps what hangs from the right forearm when it changes, and keeps it upright however the
 *  arm swings; the old piece's geometry goes with it. */
export function syncHeld(
  held: HeldState,
  spec: {
    readonly inHand: InHand
    /** Picks the phone's finish, as 2D does. */
    readonly seed: number
    readonly hand: Object3D
    readonly arm: Object3D
    readonly cast: { readonly kit: Kit; readonly toon: MeshToonMaterial }
  }
): HeldState {
  const { inHand, seed } = spec
  const key = heldKeyOf(inHand, seed)
  let next = held

  if (held.key !== key) {
    releaseHeld(held, spec.hand)
    next = { key, ...(key === '' ? {} : { mesh: heldMesh(inHand, { seed, cast: spec.cast }) }) }

    if (next.mesh !== undefined) {
      spec.hand.add(next.mesh)
    }
  }

  next.mesh?.rotation.set(
    -(spec.arm.rotation.x + spec.hand.rotation.x),
    0,
    -(spec.arm.rotation.z + spec.hand.rotation.z)
  )

  return next
}

export function releaseHeld(held: HeldState, hand: Object3D | undefined): void {
  if (held.mesh !== undefined) {
    hand?.remove(held.mesh)
    held.mesh.geometry.dispose()
  }
}

// What the hands show, as a key: empty when they show nothing.
function heldKeyOf(inHand: InHand, seed: number): string {
  const { phone, hold, sheet } = inHand

  if (phone === undefined && hold === undefined && sheet === undefined) {
    return ''
  }

  const stamp = sheet === undefined || sheet === 'blank' ? sheet : stampToneOf(sheet)

  return `${phone ?? ''}:${seed % PHONE_FINISHES.length}|${hold ?? ''}|${stamp ?? ''}`
}

// Everything `inHandOf` puts in the hands, baked as one piece, as 2D draws them together.
function bakeInHand(b: Bake, inHand: InHand, seed: number): void {
  const { phone, hold, sheet } = inHand

  if (phone !== undefined) {
    phoneShape(b, phone, seed % PHONE_FINISHES.length)
  }

  if (hold !== undefined) {
    HELD_SHAPES[hold](b, HELD_TONES[hold])
  }

  if (sheet !== undefined) {
    sheetShape(b, sheet === 'blank' ? undefined : stampToneOf(sheet))
  }
}

function phoneShape(b: Bake, phone: NonNullable<InHand['phone']>, finish: number): void {
  const [body, edge, plate] = PHONE_FINISHES[finish] ?? PHONE_FINISHES[0]

  part(b, PHONE.body, body)
  part(b, PHONE.edge, edge)

  if (phone === 'read') {
    part(b, PHONE.screen, PALETTE.screen)
    part(b, PHONE.text, PALETTE.text)
  } else {
    part(b, PHONE.plate, plate)
  }
}

function sheetShape(b: Bake, stamp: string | undefined): void {
  part(b, SHEET.page, PALETTE.paper)

  if (stamp !== undefined) {
    part(b, SHEET.stamp, stamp)
  }
}

// A rounded box from its centre, size and corner, all in rig units.
function part(
  b: Bake,
  [x, y, z, w, h, d, r]: readonly [number, number, number, number, number, number, number],
  color: string
): void {
  b.round([x, y, z], [w, h, d, r], color)
}

function heldMesh(
  inHand: InHand,
  spec: {
    readonly seed: number
    readonly cast: { readonly kit: Kit; readonly toon: MeshToonMaterial }
  }
): Mesh {
  const holder = new Group()
  const bake = createBake(spec.cast.kit, holder)

  bake.at(holder, 0)
  bakeInHand(bake, inHand, spec.seed)

  const mesh = new Mesh(bake.done(false), spec.cast.toon)

  mesh.position.set(...HELD_AT)

  return mesh
}
