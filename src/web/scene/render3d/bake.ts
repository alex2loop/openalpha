import {
  BoxGeometry,
  type BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  BufferGeometry as Geometry,
  Matrix4,
  type Object3D,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Uint16BufferAttribute,
  Vector3,
} from 'three'

/** A person's head in rig units: a rounded box, its centre `cy` above the neck. */
export const HEAD = Object.freeze({ w: 0.76, h: 0.64, d: 0.66, r: 0.26, cy: 0.32 })

const v3 = new Vector3()
const q = new Quaternion()
const e = new Euler()
const s3 = new Vector3()
const tone = new Color()
const ZAXIS = new Vector3(0, 0, 1)

/** The parts one figure is baked from, kept for the renderer's life and released with it. */
export function createPartKit(): {
  readonly get: (key: string, make: () => BufferGeometry) => BufferGeometry
  readonly dispose: () => void
} {
  const kit = new Map<string, BufferGeometry>()

  return {
    get: (key, make) => {
      const held = kit.get(key) ?? make()

      kit.set(key, held)

      return held
    },
    dispose: () => {
      for (const geometry of kit.values()) {
        geometry.dispose()
      }

      kit.clear()
    },
  }
}

/** The shared parts a bake clones from. */
export type Kit = ReturnType<typeof createPartKit>

/** Where a part sits in its joint's frame, and how it is turned. */
type Place = readonly [x: number, y: number, z: number, rx?: number, ry?: number, rz?: number]

interface DecalLook {
  readonly color: string
  readonly shape?: 'disc' | 'ring'
  readonly lift?: number
}

/** Parts being baked into one geometry, each following the joint `at` named last. */
export interface Bake {
  at(joint: Object3D, boneIndex: number): void
  round(at: Place, size: readonly [number, number, number, number], color: string): void
  sphere(
    at: readonly [number, number, number],
    radii: readonly [number, number, number],
    color: string
  ): void
  cylinder(at: Place, size: readonly [number, number, number], color: string): void
  torus(
    at: readonly [number, number, number],
    size: readonly [number, number, number?],
    color: string
  ): void
  decal(
    at: readonly [number, number],
    size: readonly [number, number],
    look: string | DecalLook
  ): void
  done(isSkinned: boolean): BufferGeometry
}

const DECAL_LIFT = 0.004

/** A bake over `kit`'s parts in the rest frame of `pivot`. */
export function createBake(kit: Kit, pivot: Object3D): Bake {
  const out: BakeOut = { position: [], normal: [], color: [], index: [], skin: [] }
  const frame = new Matrix4()
  const inverse = new Matrix4().copy(pivot.matrixWorld).invert()
  let bone = 0
  const add = (geometry: BufferGeometry, color: string, local: Matrix4) =>
    addPart(out, { geometry, color, matrix: new Matrix4().copy(frame).multiply(local), bone })

  return {
    at(joint, boneIndex) {
      frame.copy(inverse).multiply(joint.matrixWorld)
      bone = Math.max(0, boneIndex)
    },
    round: (at, [w, h, d, r], color) => add(roundedBox(kit, [w, h, d, r]), color, place(at)),
    sphere: (at, radii, color) => add(sphereOf(kit), color, place(at, radii)),
    cylinder: (at, size, color) => add(cylinderOf(kit, size), color, place(at)),
    torus: (at, size, color) => add(torusOf(kit, size), color, place([...at, Math.PI / 2, 0, 0])),
    decal: (at, size, look) => {
      const {
        color,
        shape = 'disc',
        lift = DECAL_LIFT,
      } = typeof look === 'string' ? { color: look } : look

      add(decalOf(kit, shape), color, onHead(at, size, lift))
    },
    done: (isSkinned) => toGeometry(out, isSkinned),
  }
}

function sphereOf(kit: Kit): BufferGeometry {
  return kit.get('sphere', () => new SphereGeometry(1, 10, 8))
}

function cylinderOf(kit: Kit, [top, bottom, h]: readonly [number, number, number]): BufferGeometry {
  return kit.get(`cyl${top}_${bottom}_${h}`, () => new CylinderGeometry(top, bottom, h, 10))
}

function torusOf(
  kit: Kit,
  [radius, tube, arc = Math.PI * 2]: readonly [number, number, number?]
): BufferGeometry {
  return kit.get(`tor${radius}_${tube}_${arc}`, () => new TorusGeometry(radius, tube, 6, 18, arc))
}

function decalOf(kit: Kit, shape: 'disc' | 'ring'): BufferGeometry {
  return shape === 'ring'
    ? kit.get('ring', () => new TorusGeometry(1, 0.14, 5, 14))
    : kit.get('disc', () => new CircleGeometry(1, 12))
}

function place(at: Place, size: readonly [number, number, number] = [1, 1, 1]): Matrix4 {
  const [x, y, z, rx = 0, ry = 0, rz = 0] = at

  return new Matrix4().compose(v3.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s3.set(...size))
}

// A flat disc laid on the rounded head: its depth and outward normal where (x, y) meets it.
function onHead(
  at: readonly [number, number],
  size: readonly [number, number],
  lift: number
): Matrix4 {
  const [x, y] = at
  const inner = [HEAD.w / 2 - HEAD.r, HEAD.h / 2 - HEAD.r, HEAD.d / 2 - HEAD.r]
  const qx = Math.max(Math.abs(x) - (inner[0] ?? 0), 0)
  const qy = Math.max(Math.abs(y - HEAD.cy) - (inner[1] ?? 0), 0)
  const sq = Math.sqrt(Math.max(0, HEAD.r * HEAD.r - qx * qx - qy * qy))
  const normal = new Vector3(
    (qx * Math.sign(x)) / HEAD.r,
    (qy * Math.sign(y - HEAD.cy)) / HEAD.r,
    sq / HEAD.r
  ).normalize()
  const origin = new Vector3(x, y, (inner[2] ?? 0) + sq).addScaledVector(normal, lift)

  return new Matrix4().compose(
    origin,
    new Quaternion().setFromUnitVectors(ZAXIS, normal),
    new Vector3(size[0], size[1], 1)
  )
}

function roundedBox(
  kit: Kit,
  [w, h, d, r]: readonly [number, number, number, number]
): BufferGeometry {
  const radius = Math.max(0.0005, Math.min(r, w / 2, h / 2, d / 2) * 0.999)

  return kit.get(`rb${w}_${h}_${d}_${radius}`, () => {
    const geometry = new BoxGeometry(1, 1, 1, 3, 3, 3)
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')

    for (let v = 0; v < position.count; v++) {
      const signs = [position.getX(v), position.getY(v), position.getZ(v)].map(Math.sign)
      const push = [position.getX(v), position.getY(v), position.getZ(v)].map((u) =>
        Math.abs(u) > 0.4 ? Math.sign(u) : 0
      )
      const length = Math.hypot(...push) || 1
      const [dx = 0, dy = 0, dz = 0] = push.map((u) => u / length)
      const [sx = 0, sy = 0, sz = 0] = signs

      position.setXYZ(
        v,
        sx * (w / 2 - radius) + dx * radius,
        sy * (h / 2 - radius) + dy * radius,
        sz * (d / 2 - radius) + dz * radius
      )
      normal.setXYZ(v, dx, dy, dz)
    }

    return geometry
  })
}

interface BakeOut {
  readonly position: number[]
  readonly normal: number[]
  readonly color: number[]
  readonly index: number[]
  readonly skin: number[]
}

function addPart(
  out: BakeOut,
  part: {
    readonly geometry: BufferGeometry
    readonly color: string
    readonly matrix: Matrix4
    readonly bone: number
  }
): void {
  const copy = part.geometry.clone().applyMatrix4(part.matrix)
  const position = copy.getAttribute('position')
  const normal = copy.getAttribute('normal')
  const offset = out.position.length / 3

  tone.set(part.color)

  for (let v = 0; v < position.count; v++) {
    out.position.push(position.getX(v), position.getY(v), position.getZ(v))
    out.normal.push(normal.getX(v), normal.getY(v), normal.getZ(v))
    out.color.push(tone.r, tone.g, tone.b)
    out.skin.push(part.bone, 0, 0, 0)
  }

  const index = copy.getIndex()

  for (let k = 0; k < (index?.count ?? position.count); k++) {
    out.index.push((index === null ? k : index.getX(k)) + offset)
  }

  copy.dispose()
}

function toGeometry(out: BakeOut, isSkinned: boolean): BufferGeometry {
  const geometry = new Geometry()

  geometry.setAttribute('position', new Float32BufferAttribute(out.position, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(out.normal, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(out.color, 3))

  if (isSkinned) {
    const weights = out.skin.map((_, k) => (k % 4 === 0 ? 1 : 0))

    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(out.skin, 4))
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4))
  }

  geometry.setIndex(out.index)
  geometry.computeBoundingSphere()

  return geometry
}
