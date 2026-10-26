import { BoxGeometry, BufferAttribute, BufferGeometry, Color } from 'three'

import { toUnits } from '@/web/scene/render3d/space'

/** One box in world px: its floor corner (`x`, `z`), footprint `w` by `d`, base height `y`, its
 *  own height `h`, and a colour; `isRound` softens its edges. */
export interface Box {
  readonly x: number
  readonly z: number
  readonly w: number
  readonly d: number
  readonly y: number
  readonly h: number
  readonly color: string
  readonly isRound?: boolean
}

/** Where a box stands, in world px: corner, footprint, base height and height. */
export type Spot = readonly [x: number, z: number, w: number, d: number, y: number, h: number]

// A side under this many px stays sharp; a rounded edge is this share of the smallest side.
const MIN_ROUND_PX = 2.5
const ROUND_SHARE = 0.1
const SHARP_VERTICES = 24
const SHARP_INDICES = 36

interface RoundTemplate {
  readonly count: number
  readonly signs: Float32Array
  readonly pushes: Float32Array
  readonly index: ArrayLike<number>
}

let roundTemplate: RoundTemplate | undefined
let sharpTemplate: BoxGeometry | undefined

export function box(spot: Spot, color: string, isRound?: boolean): Box {
  const [x, z, w, d, y, h] = spot

  return { x, z, w, d, y, h, color, ...(isRound === true ? { isRound } : {}) }
}

/** One vertex-coloured geometry of every box, so a room's furniture is one draw call. */
export function mergeBoxes(boxes: readonly Box[]): BufferGeometry {
  const sizes = boxes.map((piece) => (isRounded(piece) ? roundOf() : undefined))
  const vertices = sizes.reduce((sum, round) => sum + (round?.count ?? SHARP_VERTICES), 0)
  const indices = sizes.reduce((sum, round) => sum + (round?.index.length ?? SHARP_INDICES), 0)
  const out = {
    position: new Float32Array(vertices * 3),
    normal: new Float32Array(vertices * 3),
    color: new Float32Array(vertices * 3),
    index: new Uint32Array(indices),
    vertex: 0,
    at: 0,
  }

  boxes.forEach((piece, i) => {
    const round = sizes[i]

    if (round === undefined) {
      writeSharp(out, piece)
    } else {
      writeRound(out, piece, round)
    }
  })

  return toGeometry(out)
}

interface Output {
  readonly position: Float32Array
  readonly normal: Float32Array
  readonly color: Float32Array
  readonly index: Uint32Array
  vertex: number
  at: number
}

const tint = new Color()

function isRounded(piece: Box): boolean {
  return piece.isRound === true && Math.min(piece.w, piece.h, piece.d) >= MIN_ROUND_PX
}

function writeSharp(out: Output, piece: Box): void {
  const template = sharpOf()
  const position = template.attributes.position?.array ?? []
  const normal = template.attributes.normal?.array ?? []
  const index = template.index?.array ?? []
  const size = [piece.w, piece.h, piece.d]
  const center = centerOf(piece)

  tint.set(piece.color)

  for (let v = 0; v < SHARP_VERTICES; v++) {
    for (let axis = 0; axis < 3; axis++) {
      const o = (out.vertex + v) * 3 + axis

      out.position[o] =
        toUnits((position[v * 3 + axis] ?? 0) * (size[axis] ?? 0)) + (center[axis] ?? 0)
      out.normal[o] = normal[v * 3 + axis] ?? 0
    }

    paint(out, out.vertex + v)
  }

  copyIndex(out, index, SHARP_VERTICES)
}

function writeRound(out: Output, piece: Box, round: RoundTemplate): void {
  const radius = toUnits(Math.min(piece.w, piece.h, piece.d) * ROUND_SHARE)
  const half = [
    toUnits(piece.w) / 2 - radius,
    toUnits(piece.h) / 2 - radius,
    toUnits(piece.d) / 2 - radius,
  ]
  const center = centerOf(piece)

  tint.set(piece.color)

  for (let v = 0; v < round.count; v++) {
    for (let axis = 0; axis < 3; axis++) {
      const a = v * 3 + axis
      const o = (out.vertex + v) * 3 + axis
      const push = round.pushes[a] ?? 0

      out.position[o] =
        (center[axis] ?? 0) + (round.signs[a] ?? 0) * (half[axis] ?? 0) + push * radius
      out.normal[o] = push
    }

    paint(out, out.vertex + v)
  }

  copyIndex(out, round.index, round.count)
}

function centerOf(piece: Box): readonly [number, number, number] {
  return [
    toUnits(piece.x + piece.w / 2),
    toUnits(piece.y + piece.h / 2),
    toUnits(piece.z + piece.d / 2),
  ]
}

function paint(out: Output, vertex: number): void {
  out.color[vertex * 3] = tint.r
  out.color[vertex * 3 + 1] = tint.g
  out.color[vertex * 3 + 2] = tint.b
}

function copyIndex(out: Output, index: ArrayLike<number>, vertices: number): void {
  for (let k = 0; k < index.length; k++) {
    out.index[out.at + k] = (index[k] ?? 0) + out.vertex
  }

  out.at += index.length
  out.vertex += vertices
}

function toGeometry(out: Output): BufferGeometry {
  const geometry = new BufferGeometry()

  geometry.setAttribute('position', new BufferAttribute(out.position, 3))
  geometry.setAttribute('normal', new BufferAttribute(out.normal, 3))
  geometry.setAttribute('color', new BufferAttribute(out.color, 3))
  geometry.setIndex(new BufferAttribute(out.index, 1))
  geometry.computeBoundingSphere()

  return geometry
}

function sharpOf(): BoxGeometry {
  sharpTemplate ??= new BoxGeometry(1, 1, 1)

  return sharpTemplate
}

// A rounded box is a 3x3x3-segment cube: each vertex keeps its octant sign and a unit push out.
function roundOf(): RoundTemplate {
  if (roundTemplate !== undefined) {
    return roundTemplate
  }

  const cube = new BoxGeometry(1, 1, 1, 3, 3, 3)
  const position = cube.attributes.position?.array ?? []
  const count = position.length / 3
  const signs = new Float32Array(count * 3)
  const pushes = new Float32Array(count * 3)

  for (let v = 0; v < count; v++) {
    const push = [0, 1, 2].map((axis) => {
      const value = position[v * 3 + axis] ?? 0

      signs[v * 3 + axis] = Math.sign(value)

      return Math.abs(value) > 0.4 ? Math.sign(value) : 0
    })
    const length = Math.hypot(...push) || 1

    push.forEach((value, axis) => {
      pushes[v * 3 + axis] = value / length
    })
  }

  roundTemplate = { count, signs, pushes, index: Array.from(cube.index?.array ?? []) }
  cube.dispose()

  return roundTemplate
}
