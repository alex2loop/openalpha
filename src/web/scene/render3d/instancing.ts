import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  Euler,
  Float32BufferAttribute,
  InstancedMesh,
  type Material,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three'

import { toUnits } from '@/web/scene/render3d/space'

/** One repeated item drawn as instances of one mesh: one draw call however many show. */
export interface Pool {
  readonly mesh: InstancedMesh
  /** Instances placed since `begin`; the rest hide at `end`. */
  count: number
  /** A key of what the pool shows; unchanged, nothing is rewritten. */
  key: string
}

/** One instance in world px: where its centre stands, its size, its turn about y, its colour. */
interface Placement {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly size: readonly [w: number, h: number, d: number]
  readonly yaw?: number
  readonly tilt?: number
  readonly color?: string
}

const matrix = new Matrix4()
const at = new Vector3()
const scale = new Vector3()
const turn = new Quaternion()
const euler = new Euler()
const tone = new Color()

export function createPool(
  geometry: BufferGeometry,
  material: Material,
  spec: { readonly cap: number; readonly order?: number }
): Pool {
  const mesh = new InstancedMesh(geometry, material, spec.cap)

  mesh.count = 0
  mesh.frustumCulled = false

  if (spec.order !== undefined) {
    mesh.renderOrder = spec.order
  }

  return { mesh, count: 0, key: '' }
}

/** Starts a rewrite when `key` differs from what the pool shows; false when nothing changed. */
export function beginPool(pool: Pool, key: string): boolean {
  if (pool.key === key) {
    return false
  }

  pool.key = key
  pool.count = 0

  return true
}

/** Places the next instance; past the pool's cap the rest are dropped. */
export function placeInstance(pool: Pool, place: Placement): void {
  if (pool.count >= pool.mesh.instanceMatrix.count) {
    return
  }

  const [w, h, d] = place.size

  at.set(toUnits(place.x), toUnits(place.y), toUnits(place.z))
  scale.set(toUnits(w), toUnits(h), toUnits(d))
  turn.setFromEuler(euler.set(place.tilt ?? 0, place.yaw ?? 0, 0))
  pool.mesh.setMatrixAt(pool.count, matrix.compose(at, turn, scale))

  if (place.color !== undefined) {
    pool.mesh.setColorAt(pool.count, tone.set(place.color))
  }

  pool.count++
}

export function endPool(pool: Pool): void {
  pool.mesh.count = pool.count
  pool.mesh.instanceMatrix.needsUpdate = true

  if (pool.mesh.instanceColor !== null) {
    pool.mesh.instanceColor.needsUpdate = true
  }
}

/** The geometries and textures every pool shares, made once per mount. */
export interface Shapes {
  readonly box: BoxGeometry
  readonly flat: PlaneGeometry
  readonly dot: BufferGeometry
  readonly glow: CanvasTexture
  readonly disposables: readonly { dispose(): void }[]
}

const GLOW_TEXTURE_PX = 64
const DOT_SEGMENTS = 14
const DOT_INNER = 0.66
const DOT_RIM_TONE = [0.17, 0.14, 0.2] as const

export function createShapes(): Shapes {
  const box = new BoxGeometry(1, 1, 1)
  // White vertex colours, so the vertex-coloured room materials take the instance colour alone.
  const white = new Float32Array(box.getAttribute('position').count * 3).fill(1)

  box.setAttribute('color', new Float32BufferAttribute(white, 3))
  const flat = new PlaneGeometry(1, 1)
  const dot = createDot()
  const glow = createGlow()

  return { box, flat, dot, glow, disposables: [box, flat, dot, glow] }
}

// A soft round blob: white at the middle, clear at the edge; tinted by each material.
function createGlow(): CanvasTexture {
  const canvas = document.createElement('canvas')
  const g = canvas.getContext('2d')
  const half = GLOW_TEXTURE_PX / 2

  canvas.width = GLOW_TEXTURE_PX
  canvas.height = GLOW_TEXTURE_PX

  if (g !== null) {
    const gradient = g.createRadialGradient(half, half, 0, half, half, half)

    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gradient
    g.fillRect(0, 0, GLOW_TEXTURE_PX, GLOW_TEXTURE_PX)
  }

  return new CanvasTexture(canvas)
}

// A status dot: a dark rim and a white middle that the instance's colour tints.
function createDot(): BufferGeometry {
  const rim = new CircleGeometry(1, DOT_SEGMENTS)
  const middle = new CircleGeometry(DOT_INNER, DOT_SEGMENTS)
  const rimCount = rim.getAttribute('position').count
  const middlePosition = Array.from(middle.getAttribute('position').array).map((value, k) =>
    k % 3 === 2 ? 0.02 : value
  )
  const geometry = new BufferGeometry()
  const colors = [
    ...Array.from({ length: rimCount }, () => DOT_RIM_TONE).flat(),
    ...Array.from({ length: middle.getAttribute('position').count }, () => [1, 1, 1]).flat(),
  ]

  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([...rim.getAttribute('position').array, ...middlePosition], 3)
  )
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.setIndex([
    ...(rim.getIndex()?.array ?? []),
    ...Array.from(middle.getIndex()?.array ?? [], (i) => i + rimCount),
  ])
  rim.dispose()
  middle.dispose()

  return geometry
}
