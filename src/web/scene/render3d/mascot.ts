import { type BufferGeometry, Group } from 'three'

import type { BuiltFigure } from '@/web/scene/render3d/figure'
import { createBake, type Kit } from '@/web/scene/render3d/bake'
import { MASCOT_TONES } from '@/web/scene/sprites/palette'

type Part = { readonly parent: Group; readonly geometry: BufferGeometry }

// The egg's layers, bottom to top: centre height, height, width, depth (rig units).
const LAYERS: readonly (readonly [number, number, number, number])[] = Object.freeze([
  [0.22, 0.34, 0.78, 0.62],
  [0.36, 0.3, 1.0, 0.8],
  [0.62, 0.32, 1.12, 0.9],
  [0.9, 0.3, 1.08, 0.86],
  [1.16, 0.22, 0.9, 0.72],
  [1.34, 0.16, 0.62, 0.5],
])
const ROUND_SHARE = 0.12
const FACE_Z = 0.46
const EYE_Y = 0.98
const EYE_X = 0.25
const CURL: readonly (readonly [number, number])[] = Object.freeze([
  [0, 1.56],
  [0.075, 1.635],
  [0, 1.71],
  [-0.075, 1.71],
])
const CURL_PX = 0.075
const ARM: readonly [number, number, number] = [0.15, 0.34, 0.15]
const FOOT: readonly [number, number, number] = [0.28, 0.12, 0.36]

/** Bé Alpha: the egg, its face, its curl, two arms and two feet, each part its own mesh so each
 *  keeps its own outline; the eyes are a group of their own so a blink can squash them. */
export function buildMascot(kit: Kit, pivot: Group): BuiltFigure & { readonly eyes: Group } {
  const body = group(pivot, [0, 0, 0])
  const eyes = group(body, [0, EYE_Y, FACE_Z])
  const parts: Part[] = [
    { parent: body, geometry: eggOf(kit, body) },
    { parent: eyes, geometry: eyesOf(kit, eyes) },
  ]
  const limb = (
    parent: Group,
    at: readonly [number, number, number],
    look: { readonly size: readonly [number, number, number]; readonly color: string }
  ) => {
    const { size, color } = look
    const joint = group(parent, at)
    const bake = createBake(kit, joint)

    bake.at(joint, 0)
    bake.round([0, -size[1] / 2, 0], [...size, Math.min(...size) * ROUND_SHARE], color)
    parts.push({ parent: joint, geometry: bake.done(false) })

    return joint
  }
  const uaL = limb(body, [-0.6, 0.86, 0], { size: ARM, color: MASCOT_TONES.limb })
  const uaR = limb(body, [0.6, 0.86, 0], { size: ARM, color: MASCOT_TONES.limb })
  const thL = limb(body, [-0.25, 0.12, 0.06], { size: FOOT, color: MASCOT_TONES.feet })
  const thR = limb(body, [0.25, 0.12, 0.06], { size: FOOT, color: MASCOT_TONES.feet })
  const joints = {
    thL,
    thR,
    shL: group(thL, [0, 0, 0]),
    shR: group(thR, [0, 0, 0]),
    uaL,
    uaR,
    faL: group(uaL, [0, -0.3, 0]),
    faR: group(uaR, [0, -0.3, 0]),
    torso: body,
    head: body,
  }

  return { joints, hips: body, bones: [], parts, eyes }
}

function group(parent: Group, at: readonly [number, number, number]): Group {
  const made = new Group()

  made.position.set(...at)
  parent.add(made)
  parent.updateMatrixWorld(true)

  return made
}

function eggOf(kit: Kit, body: Group): BufferGeometry {
  const bake = createBake(kit, body)
  const [top, bottom] = [MASCOT_TONES.top, MASCOT_TONES.bottom]

  bake.at(body, 0)
  LAYERS.forEach(([y, h, w, d], i) => {
    const t = i / (LAYERS.length - 1)
    const rgb = top.map((channel, k) =>
      Math.round((bottom[k] ?? channel) + (channel - (bottom[k] ?? channel)) * t)
    )

    bake.round(
      [0, y + h / 2, 0],
      [w, h, d, Math.min(w, h, d) * ROUND_SHARE],
      `rgb(${rgb.join(',')})`
    )
  })

  for (const side of [-1, 1]) {
    bake.round([side * 0.31, 0.62, FACE_Z], [0.15, 0.09, 0.02, 0.01], MASCOT_TONES.cheek)
  }

  bake.round([0, 0.5, FACE_Z], [0.2, 0.05, 0.02, 0.01], MASCOT_TONES.ink)
  bake.round([-0.34, 0.66, FACE_Z], [0.1, 0.1, 0.02, 0.01], MASCOT_TONES.shine)

  for (const [x, y] of CURL) {
    bake.round([x, y, 0], [CURL_PX, CURL_PX, 0.1, 0.01], MASCOT_TONES.curl)
  }

  return bake.done(false)
}

function eyesOf(kit: Kit, eyes: Group): BufferGeometry {
  const bake = createBake(kit, eyes)

  bake.at(eyes, 0)

  for (const side of [-1, 1]) {
    bake.round([side * EYE_X, 0, 0.01], [0.1, 0.2, 0.02, 0.01], MASCOT_TONES.ink)
    bake.round([side * EYE_X + 0.04, 0.05, 0.025], [0.04, 0.06, 0.012, 0.004], MASCOT_TONES.palm)
  }

  return bake.done(false)
}
