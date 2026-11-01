import {
  type BufferGeometry,
  type Group,
  InstancedMesh,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  Vector3,
} from 'three'

import type { SceneMark } from '@/web/scene/overlay-types'
import type { Standing } from '@/web/scene/render3d/characters'
import { box, mergeBoxes } from '@/web/scene/render3d/boxes'
import {
  beginPool,
  createPool,
  endPool,
  type Pool,
  placeInstance,
  type Shapes,
} from '@/web/scene/render3d/instancing'
import { toUnits } from '@/web/scene/render3d/space'
import { OUTLINE } from '@/web/scene/sprites/palette'
import { ELEVATION } from '@/web/scene/view'

// The mockup's mark: a square badge with a light top edge, a stalk pointing down at the head, and
// the "!" in front; red over a breached stop, amber over an approval.
const MARK_TONES = Object.freeze({
  stop: { body: '#E5484D', edge: '#FF8A8E', ink: '#FFFFFF', glow: '229,72,77' },
  need: { body: '#F2B33D', edge: '#FFD98A', ink: '#2B2433', glow: '242,179,61' },
} as const satisfies Record<SceneMark['tone'], unknown>)
const MAX_MARKS = 8
// The badge's centre stands this far over the head's top, a px lower every other step.
const MARK = Object.freeze({ risePx: 22, bobPx: 1, bobMs: 450 })
const GLOW = Object.freeze({ sizePx: 35, base: 0.35, swing: 0.15, periodMs: 300 })

/** The "!" marks over people in the scene: one instanced mesh per tone and a soft glow behind
 *  each. */
export interface Marks {
  readonly meshes: Readonly<Record<SceneMark['tone'], InstancedMesh>>
  readonly glows: Pool
  readonly material: MeshBasicMaterial
}

export function createMarks(shapes: Shapes, glow: Material, root: Group): Marks {
  const material = new MeshBasicMaterial({ vertexColors: true, toneMapped: false })
  const meshOf = (tone: SceneMark['tone']): InstancedMesh => {
    const mesh = new InstancedMesh(markGeometry(tone), material, MAX_MARKS)

    mesh.count = 0
    mesh.frustumCulled = false

    return mesh
  }
  const marks: Marks = {
    meshes: { stop: meshOf('stop'), need: meshOf('need') },
    glows: createPool(shapes.flat, glow, { cap: MAX_MARKS }),
    material,
  }

  root.add(marks.meshes.stop, marks.meshes.need, marks.glows.mesh)

  return marks
}

/** Places a mark over each marked person standing on the floor shown; true when one moved. */
export function syncMarks(
  marks: Marks,
  at: {
    readonly marks: readonly SceneMark[]
    readonly standing: readonly Standing[]
    readonly now: number
    readonly isReduced: boolean
  }
): boolean {
  const shown = at.marks.flatMap((mark) => {
    const person = at.standing.find(({ actor }) => actor.id === mark.actor)

    return person === undefined ? [] : [{ mark, person }]
  })
  const step = at.isReduced ? 0 : Math.floor(at.now / MARK.bobMs) % 2
  const glow = at.isReduced ? GLOW.base : GLOW.base + GLOW.swing * Math.sin(at.now / GLOW.periodMs)
  const key = shown.map(
    ({ mark, person }) => `${mark.actor}${mark.tone}${person.at.x},${person.at.y}`
  )

  if (!beginPool(marks.glows, `${key.join()}|${step}|${glow.toFixed(2)}`)) {
    return false
  }

  const counts = { stop: 0, need: 0 }
  const place = new Matrix4()

  for (const { mark, person } of shown) {
    const y = person.top + MARK.risePx - step * MARK.bobPx
    const mesh = marks.meshes[mark.tone]

    place.makeTranslation(new Vector3(toUnits(person.at.x), toUnits(y), toUnits(person.at.y)))
    mesh.setMatrixAt(counts[mark.tone]++, place)
    glowBehind(marks.glows, {
      x: person.at.x,
      y,
      z: person.at.y,
      rgb: MARK_TONES[mark.tone].glow,
      alpha: glow,
    })
  }

  for (const tone of ['stop', 'need'] as const) {
    marks.meshes[tone].count = counts[tone]
    marks.meshes[tone].instanceMatrix.needsUpdate = true
  }

  endPool(marks.glows)

  return true
}

export function disposeMarks(marks: Marks): void {
  for (const mesh of [marks.meshes.stop, marks.meshes.need]) {
    mesh.removeFromParent()
    mesh.geometry.dispose()
    mesh.dispose()
  }

  marks.glows.mesh.dispose()
  marks.material.dispose()
}

function glowBehind(
  pool: Pool,
  at: {
    readonly x: number
    readonly y: number
    readonly z: number
    readonly rgb: string
    readonly alpha: number
  }
): void {
  const [r = 0, g = 0, b = 0] = at.rgb
    .split(',')
    .map((channel) => Math.round(Number(channel) * at.alpha))

  placeInstance(pool, {
    x: at.x,
    y: at.y,
    z: at.z - 0.1,
    size: [GLOW.sizePx, GLOW.sizePx, 1],
    tilt: -ELEVATION,
    color: `rgb(${r},${g},${b})`,
  })
}

// The badge in px round its centre, facing the camera along z, as the mockup's `markGeo`: each
// part is its centre (x, y), width, height, depth and colour.
function markGeometry(tone: SceneMark['tone']): BufferGeometry {
  const c = MARK_TONES[tone]
  const parts: readonly (readonly [number, number, number, number, number, string])[] = [
    [0, 0, 11, 11, 3, OUTLINE],
    [0, 0, 9, 9, 3.4, c.body],
    [0, 3.9, 9, 1, 3.5, c.edge],
    [0, -6, 5, 1, 3, OUTLINE],
    [0, -7, 3, 1, 3, c.body],
    [0, -8, 1, 1, 3, OUTLINE],
    [0, 1.5, 2, 4, 3.8, c.ink],
    [0, -2.6, 2, 1.4, 3.8, c.ink],
  ]

  return mergeBoxes(
    parts.map(([cx, cy, w, h, d, colour]) => box([cx - w / 2, -d / 2, w, d, cy - h / 2, h], colour))
  )
}
