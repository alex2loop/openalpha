import { BufferGeometry, Color, Float32BufferAttribute } from 'three'

import type { AnimalPart, Ellipsoid } from '@/web/scene/render3d/animal-parts'
import type { DetailLevel } from '@/web/scene/sim/life/animal-model'

/** A 3x3 rotation, row by row. */
type Rotation = readonly [number, number, number, number, number, number, number, number, number]
type Vec = readonly [number, number, number]

// Rings round each ellipsoid at a detail level, as the mockup's `ellGeo`; the colours are shaded a
// step down so the room's light brings them to the 2D tones.
const RINGS: Readonly<Record<DetailLevel, number>> = Object.freeze({ 0: 8, 1: 12, 2: 12 })
const SHADE = 0.82
// A band stands this much proud of its ellipsoid, over this many rings.
const BAND = Object.freeze({ grow: 1.07, rings: 3 })
// A leg swings this far each walking step, the two diagonals opposite.
const LEG_SWING = 0.45
const IDENTITY: Rotation = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/** Every ellipsoid of the model in one vertex-coloured geometry, in the model's units, with its
 *  legs swung by `step` (-1, 0 or 1); the caller disposes it. */
export function buildAnimalGeometry(
  parts: readonly AnimalPart[],
  at: { readonly level: DetailLevel; readonly step: number }
): BufferGeometry {
  const out = {
    position: [] as number[],
    normal: [] as number[],
    color: [] as number[],
    index: [] as number[],
  }
  const frames = new Map<string, { readonly rotation: Rotation; readonly origin: Vec }>()

  for (const part of parts) {
    const parent = (part.parent === undefined ? undefined : frames.get(part.parent)) ?? {
      rotation: IDENTITY,
      origin: [0, 0, 0] as const,
    }
    const rotation = multiply(
      parent.rotation,
      turnOf(part.turn[0] + legSwingOf(part.name, at.step), part.turn[1])
    )
    const offset = apply(parent.rotation, part.at)
    const origin: Vec = [
      offset[0] + parent.origin[0],
      offset[1] + parent.origin[1],
      offset[2] + parent.origin[2],
    ]

    frames.set(part.name, { rotation, origin })

    for (const prim of part.prims) {
      addEllipsoid(out, { prim, rotation, origin, rings: RINGS[at.level] })
    }
  }

  const geometry = new BufferGeometry()

  geometry.setAttribute('position', new Float32BufferAttribute(out.position, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(out.normal, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(out.color, 3))
  geometry.setIndex(out.index)
  geometry.computeBoundingSphere()

  return geometry
}

function legSwingOf(name: string, step: number): number {
  if (!name.startsWith('leg')) {
    return 0
  }

  return step * (name === 'legFa' || name === 'legBb' ? LEG_SWING : -LEG_SWING)
}

interface Arrays {
  readonly position: number[]
  readonly normal: number[]
  readonly color: number[]
  readonly index: number[]
}

function addEllipsoid(
  out: Arrays,
  at: {
    readonly prim: Ellipsoid
    readonly rotation: Rotation
    readonly origin: Vec
    readonly rings: number
  }
): void {
  const { prim } = at
  const turn = multiply(at.rotation, turnOf(prim.turn[0], prim.turn[1]))
  const local = apply(at.rotation, prim.c)
  const centre: Vec = [local[0] + at.origin[0], local[1] + at.origin[1], local[2] + at.origin[2]]
  const ring = { prim, turn, centre, rings: at.rings }

  addRings(out, { ...ring, tone: prim.tone, from: 0, to: Math.PI, grow: 1, steps: at.rings })

  for (const [from, to, tone] of prim.bands ?? []) {
    addRings(out, {
      ...ring,
      tone,
      from: Math.acos(to),
      to: Math.acos(from),
      grow: BAND.grow,
      steps: BAND.rings,
    })
  }
}

// Rings of the ellipsoid from `from` to `to` along its long axis (radians), `grow` wider across.
function addRings(
  out: Arrays,
  at: {
    readonly prim: Ellipsoid
    readonly turn: Rotation
    readonly centre: Vec
    readonly rings: number
    readonly tone: string
    readonly from: number
    readonly to: number
    readonly grow: number
    readonly steps: number
  }
): void {
  const { r } = at.prim
  const tone = new Color(at.tone).multiplyScalar(SHADE)
  const base = out.position.length / 3
  const around = at.rings

  for (let i = 0; i <= at.steps; i++) {
    const th = at.from + ((at.to - at.from) * i) / at.steps
    const ct = Math.cos(th)
    const st = Math.sin(th)

    for (let j = 0; j <= around; j++) {
      const f = (j / around) * Math.PI * 2
      const p = apply(at.turn, [
        ct * r[0],
        st * Math.cos(f) * r[1] * at.grow,
        st * Math.sin(f) * r[2] * at.grow,
      ])
      const n = apply(
        at.turn,
        normalOf([ct / r[0], (st * Math.cos(f)) / r[1], (st * Math.sin(f)) / r[2]])
      )

      out.position.push(p[0] + at.centre[0], p[1] + at.centre[1], p[2] + at.centre[2])
      out.normal.push(n[0], n[1], n[2])
      out.color.push(tone.r, tone.g, tone.b)
    }
  }

  for (let i = 0; i < at.steps; i++) {
    for (let j = 0; j < around; j++) {
      const a = base + i * (around + 1) + j
      const b = a + around + 1

      out.index.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
}

function normalOf(v: Vec): Vec {
  const length = Math.hypot(v[0], v[1], v[2]) || 1

  return [v[0] / length, v[1] / length, v[2] / length]
}

// A turn about z, then y, as the mockup's `anRot`.
function turnOf(z: number, y: number): Rotation {
  const ca = Math.cos(z)
  const sa = Math.sin(z)
  const cb = Math.cos(y)
  const sb = Math.sin(y)

  return [cb * ca, -cb * sa, sb, sa, ca, 0, -sb * ca, sb * sa, cb]
}

function multiply(a: Rotation, b: Rotation): Rotation {
  const at = (i: number, j: number): number =>
    (a[i * 3] ?? 0) * (b[j] ?? 0) +
    (a[i * 3 + 1] ?? 0) * (b[3 + j] ?? 0) +
    (a[i * 3 + 2] ?? 0) * (b[6 + j] ?? 0)

  return [at(0, 0), at(0, 1), at(0, 2), at(1, 0), at(1, 1), at(1, 2), at(2, 0), at(2, 1), at(2, 2)]
}

function apply(m: Rotation, v: Vec): Vec {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}
