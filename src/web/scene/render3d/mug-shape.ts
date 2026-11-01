import {
  type BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  RingGeometry,
  TorusGeometry,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

import { toUnits } from '@/web/scene/render3d/space'

// The mockup's mug in world px: an open cup narrowing to its foot, a rim ring, the coffee under
// the rim and a handle on the right.
const MUG = Object.freeze({ r: 2, h: 3.6, segments: 20, cup: '#F7F5EF', inner: '#E4E0D6' })
const RIM = '#FFFFFF'
const COFFEE = Object.freeze({ tone: '#4A2C17', drop: 0.7 })
const HANDLE = Object.freeze({ r: 0.95, tube: 0.27, out: 0.45, at: 0.52 })

/** Every turned mug on the floor's desks as one geometry, in three.js units; absent with none.
 *  The caller owns and disposes it. */
export function buildMugsGeometry(
  spots: readonly (readonly [x: number, y: number, z: number])[]
): BufferGeometry | undefined {
  if (spots.length === 0) {
    return undefined
  }

  const one = createMugGeometry()
  const placed = spots.map(([x, y, z]) =>
    one
      .clone()
      .scale(toUnits(1), toUnits(1), toUnits(1))
      .translate(toUnits(x), toUnits(y), toUnits(z))
  )
  const merged = mergeGeometries(placed)

  one.dispose()

  for (const part of placed) {
    part.dispose()
  }

  return merged
}

function createMugGeometry(): BufferGeometry {
  const { r, h, segments } = MUG
  const parts: [BufferGeometry, string][] = [
    [new CylinderGeometry(r, r * 0.88, h, segments, 1, true).translate(0, h / 2, 0), MUG.cup],
    [
      new CylinderGeometry(r * 0.8, r * 0.78, 0.7, segments, 1, true).translate(0, h - 0.35, 0),
      MUG.inner,
    ],
    [new RingGeometry(r * 0.8, r, segments).rotateX(-Math.PI / 2).translate(0, h, 0), RIM],
    [
      new CircleGeometry(r * 0.8, segments).rotateX(-Math.PI / 2).translate(0, h - COFFEE.drop, 0),
      COFFEE.tone,
    ],
    [new CircleGeometry(r * 0.88, segments).rotateX(Math.PI / 2).translate(0, 0.01, 0), MUG.cup],
    [
      new TorusGeometry(HANDLE.r, HANDLE.tube, 6, 12).translate(r + HANDLE.out, h * HANDLE.at, 0),
      MUG.cup,
    ],
  ]

  for (const [part, tone] of parts) {
    const color = new Color(tone)
    const count = part.getAttribute('position').count

    part.setAttribute(
      'color',
      new Float32BufferAttribute(
        Array.from({ length: count }, () => [color.r, color.g, color.b]).flat(),
        3
      )
    )
  }

  const merged = mergeGeometries(parts.map(([part]) => part))

  for (const [part] of parts) {
    part.dispose()
  }

  return merged
}
