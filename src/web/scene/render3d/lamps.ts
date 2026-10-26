import { Color, PointLight, type Scene } from 'three'

import type { FloorProps } from '@/web/scene/render3d/props'
import type { Point, RoomId } from '@/web/scene/types'
import { toUnits } from '@/web/scene/render3d/space'
import { WARM_RGB } from '@/web/scene/sprites/daylight'

/** The lamps' warm point lights; a spare one stays in the scene with no intensity, so the count
 *  every material compiled for never changes. `shown` is the lamp each light sits on and `glow`
 *  its brightness; `near` and `gaps` are scratch the pick reuses every frame. */
export interface Lamps {
  readonly lights: readonly PointLight[]
  readonly shown: (Lamp | undefined)[]
  readonly near: (Lamp | undefined)[]
  readonly gaps: number[]
  glow: number
}

type Lamp = FloorProps['lamps'][number]

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

  return {
    lights,
    shown: Array.from({ length: MAX_POINT_LIGHTS }, () => undefined),
    near: Array.from({ length: MAX_POINT_LIGHTS }, () => undefined),
    gaps: Array.from({ length: MAX_POINT_LIGHTS }, () => Number.POSITIVE_INFINITY),
    glow: 0,
  }
}

/** Lights the lamps of the lit rooms nearest the camera's centre, dimmed with the lamps; true
 *  when a light moved or changed. Allocates nothing. */
export function syncLamps(lamps: Lamps, spec: LampSpec): boolean {
  pickNearest(lamps, spec)

  if (lamps.glow === spec.lampGlow && isSamePick(lamps)) {
    return false
  }

  lamps.glow = spec.lampGlow

  for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
    const lamp = lamps.near[i]
    const light = lamps.lights[i]

    lamps.shown[i] = lamp

    if (light !== undefined) {
      light.intensity = lamp === undefined ? 0 : LAMP_LIGHT.intensity * spec.lampGlow
    }

    if (light !== undefined && lamp !== undefined) {
      light.position.set(toUnits(lamp.at.x), toUnits(lamp.shadeY), toUnits(lamp.at.y))
    }
  }

  return true
}

// Keeps the nearest lit lamps in `near`, nearest first; a tie keeps the props' order.
function pickNearest(lamps: Lamps, spec: LampSpec): void {
  const { near, gaps } = lamps
  const { focus } = spec

  near.fill(undefined)
  gaps.fill(Number.POSITIVE_INFINITY)

  for (const lamp of spec.lamps) {
    if (!spec.lit.has(lamp.room)) {
      continue
    }

    const gap = focus === undefined ? 0 : Math.hypot(lamp.at.x - focus.x, lamp.at.y - focus.y)
    let slot = MAX_POINT_LIGHTS

    while (slot > 0 && gap < (gaps[slot - 1] ?? Number.POSITIVE_INFINITY)) {
      slot--
    }

    for (let i = MAX_POINT_LIGHTS - 1; i > slot; i--) {
      near[i] = near[i - 1]
      gaps[i] = gaps[i - 1] ?? Number.POSITIVE_INFINITY
    }

    if (slot < MAX_POINT_LIGHTS) {
      near[slot] = lamp
      gaps[slot] = gap
    }
  }
}

function isSamePick(lamps: Lamps): boolean {
  for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
    if (lamps.near[i] !== lamps.shown[i]) {
      return false
    }
  }

  return true
}

export function disposeLamps(lamps: Lamps): void {
  for (const light of lamps.lights) {
    light.removeFromParent()
    light.dispose()
  }
}
