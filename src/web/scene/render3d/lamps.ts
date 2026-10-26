import { Color, PointLight, type Scene } from 'three'

import type { FloorProps } from '@/web/scene/render3d/props'
import type { Point, RoomId } from '@/web/scene/types'
import { toUnits } from '@/web/scene/render3d/space'
import { WARM_RGB } from '@/web/scene/sprites/daylight'

/** The lamps' warm point lights; a spare one stays in the scene with no intensity, so the count
 *  every material compiled for never changes. */
export interface Lamps {
  readonly lights: readonly PointLight[]
  key: string
}

/** What the lamps follow: the floor's lamps, the rooms lit and how bright, and the camera's
 *  centre on the floor. */
interface LampSpec {
  readonly lamps: FloorProps['lamps']
  readonly lit: ReadonlySet<RoomId>
  readonly lampGlow: number
  readonly focus: Point | undefined
}

// More point lights cost every lit fragment; the nearest lit rooms take them.
const MAX_POINT_LIGHTS = 4
const LAMP_LIGHT = Object.freeze({ intensity: 10, distancePx: 192, decay: 2 })

export function createLamps(scene: Scene): Lamps {
  const color = new Color(`rgb(${WARM_RGB})`)
  const lights = Array.from(
    { length: MAX_POINT_LIGHTS },
    () => new PointLight(color, 0, toUnits(LAMP_LIGHT.distancePx), LAMP_LIGHT.decay)
  )

  scene.add(...lights)

  return { lights, key: '' }
}

/** Lights the lamps of the lit rooms nearest the camera's centre, dimmed with the lamps; true
 *  when a light moved or changed. */
export function syncLamps(lamps: Lamps, spec: LampSpec): boolean {
  const { focus } = spec
  const near = spec.lamps
    .filter((lamp) => spec.lit.has(lamp.room))
    .map((lamp) => ({
      lamp,
      gap: focus === undefined ? 0 : Math.hypot(lamp.at.x - focus.x, lamp.at.y - focus.y),
    }))
    .sort((a, b) => a.gap - b.gap)
    .slice(0, MAX_POINT_LIGHTS)
    .map(({ lamp }) => lamp)
  const key = `${near.map((lamp) => `${lamp.at.x},${lamp.at.y}`).join(';')}|${spec.lampGlow}`

  if (lamps.key === key) {
    return false
  }

  lamps.key = key
  lamps.lights.forEach((light, i) => {
    const lamp = near[i]

    light.intensity = lamp === undefined ? 0 : LAMP_LIGHT.intensity * spec.lampGlow

    if (lamp !== undefined) {
      light.position.set(toUnits(lamp.at.x), toUnits(lamp.shadeY), toUnits(lamp.at.y))
    }
  })

  return true
}

export function disposeLamps(lamps: Lamps): void {
  for (const light of lamps.lights) {
    light.removeFromParent()
    light.dispose()
  }
}
