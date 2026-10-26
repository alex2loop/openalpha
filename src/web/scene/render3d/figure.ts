import { BackSide, Bone, type BufferGeometry, type Group, MeshBasicMaterial } from 'three'

import type { Look } from '@/web/scene/sprites/parts'
import { type Bake, createBake, HEAD, type Kit } from '@/web/scene/render3d/bake'
import { mixHex } from '@/web/scene/render3d/space'
import { OUTLINE, PALETTE, RAMP } from '@/web/scene/sprites/palette'
import { PANTS_OF } from '@/web/scene/sprites/parts'

/** The ten joints every person bends, as bones of one skeleton. */
export const JOINTS = [
  'thL',
  'thR',
  'shL',
  'shR',
  'uaL',
  'uaR',
  'faL',
  'faR',
  'torso',
  'head',
] as const

export type Joint = (typeof JOINTS)[number]

/** One person's body before it is skinned: the joints, the baked geometry, its eyelids. */
export interface BuiltFigure {
  readonly joints: Readonly<Record<Joint, Group | Bone>>
  readonly hips: Group | Bone
  readonly bones: readonly Bone[]
  readonly body?: BufferGeometry
  readonly lids?: BufferGeometry
  /** The mascot's parts, each its own mesh with its own outline. */
  readonly parts?: readonly { readonly parent: Group; readonly geometry: BufferGeometry }[]
}

/** The colours a look is baked in; pastel, as the sprites' bodies. */
interface Tones {
  readonly skin: string
  readonly hair: string
  readonly shirt: string
  readonly pants: string
  readonly shoe: string
  readonly isFur: boolean
}

/** The hips' height standing, in rig units (one unit is sixteen world px before `FIGURE_SCALE`). */
export const STAND_H = 0.84
/** A person is drawn at this scale of the rig, so they stand a sprite's 32 px. */
export const FIGURE_SCALE = 0.94
const WHITE = '#FFFFFF'
const SKIN_LIFT = 0.06
const SHIRT_LIFT = 0.12
const PANTS_LIFT = 0.08
const HAIR_SOFTEN = 0.1
const HAIR_SOFT_TONE = '#FFF1E4'
const EYE_Y = 0.37
const EYE_X = 0.17
// An eyelid sits over the eye, the glint over the pupil.
const LID_LIFT = 0.012
const GLINT_LIFT = 0.007

/** The outline: the figure drawn again inside out, pushed along its normals by `width`. */
export function createHullMaterial(width: { value: number }): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ color: OUTLINE, side: BackSide, toneMapped: false })

  material.customProgramCacheKey = () => 'figure-hull'
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uOutlineW = width
    shader.vertexShader = `uniform float uOutlineW;\n${shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed += normal * uOutlineW;'
    )}`
  }

  return material
}

function tonesOf(look: Look): Tones {
  const isFur = look.prop === 'bear'

  return {
    isFur,
    skin: hex(mixHex(isFur ? RAMP.fur[1] : RAMP.skin[look.body][1], WHITE, SKIN_LIFT)),
    hair: hex(mixHex(RAMP.hair[look.hairTone][1], HAIR_SOFT_TONE, HAIR_SOFTEN)),
    shirt: hex(mixHex(RAMP.shirt[look.shirt][1], WHITE, SHIRT_LIFT)),
    pants: hex(mixHex(RAMP.pants[PANTS_OF[look.shirt]][1], WHITE, PANTS_LIFT)),
    shoe: RAMP.shoe[1],
  }
}

function hex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`
}

/** A person's skeleton, and every part of the look baked into one skinned geometry. */
export function buildHuman(look: Look, kit: Kit, pivot: Group): BuiltFigure {
  const bones: Bone[] = []
  const bone = (parent: Group | Bone, at: readonly [number, number, number]): Bone => {
    const made = new Bone()

    made.position.set(...at)
    parent.add(made)
    bones.push(made)

    return made
  }
  const hips = bone(pivot, [0, STAND_H, 0])
  const thL = bone(hips, [-0.16, 0, 0])
  const thR = bone(hips, [0.16, 0, 0])
  const torso = bone(hips, [0, 0, 0])
  const uaL = bone(torso, [-0.41, 0.56, 0])
  const uaR = bone(torso, [0.41, 0.56, 0])
  const joints = {
    thL,
    thR,
    shL: bone(thL, [0, -0.42, 0]),
    shR: bone(thR, [0, -0.42, 0]),
    uaL,
    uaR,
    faL: bone(uaL, [0, -0.3, 0]),
    faR: bone(uaR, [0, -0.3, 0]),
    torso,
    head: bone(torso, [0, 0.66, 0]),
  }

  pivot.updateMatrixWorld(true)

  const bake = createBake(kit, pivot)
  const t = tonesOf(look)

  bakeLegs(bake, { joints, bones, t })
  bakeTorso(bake, { joints, bones, t }, look)
  bakeArms(bake, { joints, bones, t }, look)
  bakeHead(bake, { joints, bones, t }, look)

  const lids = createBake(kit, joints.head)

  lids.at(joints.head, 0)
  eyes(lids, { tone: t.skin, isLid: true, isFur: t.isFur })

  return { joints, hips, bones, body: bake.done(true), lids: lids.done(false) }
}

interface Rig {
  readonly joints: Readonly<Record<Joint, Bone>>
  readonly bones: readonly Bone[]
  readonly t: Tones
}

function bakeLegs(b: Bake, rig: Rig): void {
  for (const side of ['L', 'R'] as const) {
    b.at(rig.joints[`th${side}`], rig.bones.indexOf(rig.joints[`th${side}`]))
    b.round([0, -0.21, 0], [0.25, 0.42, 0.27, 0.1], rig.t.pants)
    b.at(rig.joints[`sh${side}`], rig.bones.indexOf(rig.joints[`sh${side}`]))
    b.round([0, -0.17, 0], [0.23, 0.34, 0.25, 0.095], rig.t.pants)
    b.round([0, -0.36, 0.04], [0.25, 0.13, 0.34, 0.055], rig.t.shoe)
  }
}

function bakeTorso(b: Bake, rig: Rig, look: Look): void {
  const { t } = rig

  b.at(rig.joints.torso, rig.bones.indexOf(rig.joints.torso))
  b.round([0, 0.06, 0], [0.56, 0.24, 0.36, 0.11], t.pants)
  b.round([0, 0.34, 0], [0.6, 0.58, 0.38, 0.17], t.shirt)
  b.cylinder([0, 0.64, 0], [0.08, 0.08, 0.1], t.skin)
  TORSO_PROPS[look.prop]?.(b, t)
}

const TORSO_PROPS: Readonly<Partial<Record<Look['prop'], (b: Bake, t: Tones) => void>>> =
  Object.freeze({
    tie: (b, t) => {
      b.round([0, 0.34, 0.195], [0.085, 0.3, 0.03, 0.015], PALETTE.tie)
      b.round([0, 0.6, 0.17], [0.28, 0.045, 0.1, 0.02], hex(mixHex(t.shirt, WHITE, 0.6)))
    },
    apron: (b) => {
      b.round([0, 0.3, 0.195], [0.5, 0.44, 0.03, 0.02], RAMP.apron[1])
      b.round([0, 0.2, 0.215], [0.2, 0.1, 0.02, 0.01], PALETTE.pocket)
    },
    lanyard: (b) => {
      b.round([-0.1, 0.45, 0.195, 0, 0, 0.28], [0.025, 0.3, 0.02, 0.008], PALETTE.lanyard)
      b.round([0.1, 0.45, 0.195, 0, 0, -0.28], [0.025, 0.3, 0.02, 0.008], PALETTE.lanyard)
      b.round([0, 0.22, 0.2], [0.14, 0.12, 0.02, 0.025], PALETTE.badge)
    },
    scarf: (b) => {
      b.torus([0, 0.62, 0], [0.2, 0.07], RAMP.scarf[1])
      b.round([0.1, 0.46, 0.2], [0.12, 0.24, 0.04, 0.02], RAMP.scarf[1])
    },
  })

function bakeArms(b: Bake, rig: Rig, look: Look): void {
  const cuff = hex(mixHex(rig.t.shirt, WHITE, 0.28))

  for (const side of ['L', 'R'] as const) {
    b.at(rig.joints[`ua${side}`], rig.bones.indexOf(rig.joints[`ua${side}`]))
    b.round([0, -0.15, 0], [0.2, 0.34, 0.22, 0.09], rig.t.shirt)
    b.at(rig.joints[`fa${side}`], rig.bones.indexOf(rig.joints[`fa${side}`]))
    b.round([0, -0.07, 0], [0.185, 0.16, 0.2, 0.08], rig.t.shirt)
    b.round([0, -0.15, 0], [0.19, 0.03, 0.205, 0.012], cuff)
    b.sphere([0, -0.265, 0], [0.1, 0.1, 0.1], rig.t.skin)
  }

  HAND_PROPS[look.prop]?.(b)
}

// The right forearm is the joint in hand when these run.
const HAND_PROPS: Readonly<Partial<Record<Look['prop'], (b: Bake) => void>>> = Object.freeze({
  clipboard: (b) => {
    b.round([0.06, -0.3, 0.15], [0.2, 0.28, 0.03, 0.01], RAMP.board[1])
    b.round([0.06, -0.3, 0.17], [0.15, 0.22, 0.01, 0.004], PALETTE.paper)
  },
  scroll: (b) => b.cylinder([0, -0.34, 0.1, Math.PI / 2, 0, 0], [0.055, 0.055, 0.3], PALETTE.paper),
  book: (b) => b.round([0.02, -0.32, 0.08], [0.16, 0.22, 0.07, 0.02], RAMP.book[1]),
  mug: (b) => b.cylinder([0, -0.33, 0.1], [0.06, 0.055, 0.12], PALETTE.paper),
})

function bakeHead(b: Bake, rig: Rig, look: Look): void {
  const { t } = rig

  b.at(rig.joints.head, rig.bones.indexOf(rig.joints.head))
  b.round([0, HEAD.cy, 0], [HEAD.w, HEAD.h, HEAD.d, HEAD.r], t.skin)

  if (t.isFur) {
    for (const side of [-1, 1]) {
      b.sphere([side * 0.3, 0.7, 0], [0.15, 0.15, 0.1], t.skin)
    }

    b.sphere([0, 0.2, 0.3], [0.2, 0.14, 0.1], PALETTE.muzzle)
    b.sphere([0, 0.27, 0.395], [0.05, 0.032, 0.025], PALETTE.nose)
  } else {
    HAIR[look.hair](b, t.hair)
    b.decal([0, 0.235], [0.05, 0.03], PALETTE.mouth)

    for (const side of [-1, 1]) {
      b.decal([side * 0.285, 0.25], [0.065, 0.045], PALETTE.blush)
    }
  }

  HEAD_PROPS[look.prop]?.(b)
  eyes(b, { tone: PALETTE.eye, isLid: false, isFur: t.isFur })
}

const HAIR: Readonly<Record<Look['hair'], (b: Bake, tone: string) => void>> = Object.freeze({
  short: (b, c) => crown(b, c, { back: [0.36, 0.5], side: [0.4, 0.3], fringe: true }),
  bun: (b, c) => {
    crown(b, c, { back: [0.36, 0.5], side: [0.4, 0.3], fringe: true })
    b.sphere([0, 0.74, -0.17], [0.14, 0.14, 0.14], c)
  },
  cap: (b, c) => {
    crown(b, c, { back: [0.36, 0.5], side: [0.4, 0.3], fringe: false })
    b.round([0, 0.575, -0.01], [0.79, 0.21, 0.7, 0.1], RAMP.cap[1])
    b.round([0, 0.5, 0.37, 0.12, 0, 0], [0.66, 0.04, 0.22, 0.015], RAMP.cap[2])
  },
  bob: (b, c) => crown(b, c, { back: [0.28, 0.56], side: [0.3, 0.46], fringe: false }),
  long: (b, c) => crown(b, c, { back: [0.12, 0.86], side: [0.3, 0.52], fringe: false }),
  bald: (b, c) => {
    for (const side of [-1, 1]) {
      b.round([side * 0.385, 0.3, 0], [0.06, 0.2, 0.34, 0.03], c)
    }

    b.round([0, 0.28, -0.31], [0.6, 0.16, 0.06, 0.03], c)
  },
})

function crown(
  b: Bake,
  c: string,
  shape: {
    readonly back: readonly [number, number]
    readonly side: readonly [number, number]
    readonly fringe: boolean
  }
): void {
  b.round([0, 0.575, -0.01], [0.785, 0.21, 0.69, 0.1], c)
  b.round([0, shape.back[0], -0.3], [0.78, shape.back[1], 0.16, 0.08], c)

  for (const side of [-1, 1]) {
    b.round([side * 0.385, shape.side[0], -0.02], [0.06, shape.side[1], 0.5, 0.03], c)
  }

  if (shape.fringe) {
    b.round([0, 0.54, 0.27], [0.6, 0.08, 0.14, 0.04], c)
  }
}

const HEAD_PROPS: Readonly<Partial<Record<Look['prop'], (b: Bake) => void>>> = Object.freeze({
  horns: (b) => {
    for (const side of [-1, 1]) {
      b.cylinder([side * 0.22, 0.76, 0, 0, 0, -side * 0.35], [0.025, 0.09, 0.26], RAMP.horn[0])
    }
  },
  headset: (b) => {
    b.torus([0, 0.3, 0], [0.43, 0.022, Math.PI], RAMP.metal[1])

    for (const side of [-1, 1]) {
      b.round([side * 0.43, 0.3, 0], [0.09, 0.22, 0.2, 0.04], RAMP.metal[1])
    }
  },
  visor: (b) => {
    b.round([0, 0.55, 0], [0.8, 0.12, 0.72, 0.05], RAMP.visor[1])
    b.round([0, 0.5, 0.37, 0.15, 0, 0], [0.66, 0.035, 0.22, 0.015], RAMP.visor[2])
  },
  glasses: (b) => {
    for (const side of [-1, 1]) {
      b.decal([side * EYE_X, EYE_Y], [0.105, 0.105], { color: PALETTE.frame, shape: 'ring' })
    }
  },
  monocle: (b) => b.decal([EYE_X, EYE_Y], [0.105, 0.105], { color: PALETTE.gold, shape: 'ring' }),
})

function eyes(
  b: Bake,
  spec: { readonly tone: string; readonly isLid: boolean; readonly isFur: boolean }
): void {
  const y = spec.isFur ? 0.4 : EYE_Y

  for (const side of [-1, 1]) {
    if (spec.isLid) {
      b.decal([side * EYE_X, y], [0.078, 0.092], { color: spec.tone, lift: LID_LIFT })
      continue
    }

    b.decal([side * EYE_X, y], [0.052, 0.068], spec.tone)
    b.decal([side * EYE_X + 0.014, y + 0.025], [0.016, 0.016], {
      color: PALETTE.glint,
      lift: GLINT_LIFT,
    })
  }
}
