import { AdditiveBlending, type CanvasTexture, MeshBasicMaterial, NormalBlending } from 'three'

import type { FloorProps } from '@/web/scene/render3d/props'
import type { SimView } from '@/web/scene/types'
import { isNightSun } from '@/web/scene/clock/sun'
import { beginPool, endPool, type Pool, placeInstance } from '@/web/scene/render3d/instancing'
import { LAMP_SHADE_SIZE } from '@/web/scene/render3d/props'
import { WARM_RGB } from '@/web/scene/sprites/daylight'
import { PROP_TONES } from '@/web/scene/sprites/palette'
import { ELEVATION } from '@/web/scene/view'

// The mockup's lamp glow: a warm pool on the floor and a halo round the shade, by day and night.
const LAMP_GLOW = Object.freeze({
  poolRadius: 60,
  poolRgb: '255,205,120',
  haloSize: 51.2,
  haloRgb: '255,216,144',
  day: { pool: 0.42, halo: 0.6 },
  night: { pool: 0.32, halo: 0.75 },
})
const DESK_LAMP_POOL_RADIUS = 18
/** How high a pool lies over the floor, and the turn that lays a plane flat on it. */
export const POOL_Y = 0.5
export const FLAT_TILT = -Math.PI / 2

/** The lamps' shades, their pools on the floor and their halos, each kind one instanced mesh,
 *  and the pools' shared material. */
interface LampPools {
  readonly shades: Pool
  readonly lampPools: Pool
  readonly halos: Pool
  readonly lampGlow: MeshBasicMaterial
}

/** What the lamps read: the snapshot and the floor's lamps. */
interface LampFrame {
  readonly sim: SimView
  readonly props: FloorProps
}

/** The lamp pools' own material over the shared glow texture; the caller disposes it. */
export function createLampGlow(glow: CanvasTexture): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map: glow,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    toneMapped: false,
  })
}

/** Lights the lit rooms' lamps; true when their picture changed. */
export function syncLamps(fixtures: LampPools, frame: LampFrame): boolean {
  const { lit, lampGlow } = frame.sim.props
  const isNight = isNightSun(frame.sim.light.sun)
  const key = `${frame.sim.floor}|${[...lit].join()}|${lampGlow}|${isNight}`
  const isShadeNew = beginPool(fixtures.shades, key)
  const isPoolNew = beginPool(fixtures.lampPools, key)
  const isHaloNew = beginPool(fixtures.halos, key)

  if (!(isShadeNew || isPoolNew || isHaloNew)) {
    return false
  }

  blendLampPools(fixtures.lampGlow, { isNight, lampGlow })
  placeFloorLamps(fixtures, { frame, isNight })
  placeDeskLamps(fixtures, frame)
  endPool(fixtures.shades)
  endPool(fixtures.lampPools)
  endPool(fixtures.halos)

  return true
}

// As the mockup's: every pool shares one strength, blended over the floor by day and added to it
// by night; the instances carry the bare warm colour.
function blendLampPools(
  material: MeshBasicMaterial,
  at: { readonly isNight: boolean; readonly lampGlow: number }
): void {
  const blending = at.isNight ? AdditiveBlending : NormalBlending
  const glow = at.isNight ? LAMP_GLOW.night : LAMP_GLOW.day

  material.opacity = glow.pool * at.lampGlow

  if (material.blending !== blending) {
    material.blending = blending
    material.needsUpdate = true
  }
}

// Each floor lamp's shade, lit with its room, its light pool on the floor and the halo round the
// shade, a little stronger by night.
function placeFloorLamps(
  fixtures: LampPools,
  at: { readonly frame: LampFrame; readonly isNight: boolean }
): void {
  const { lit, lampGlow } = at.frame.sim.props
  const glow = at.isNight ? LAMP_GLOW.night : LAMP_GLOW.day

  for (const lamp of at.frame.props.lamps) {
    const isOn = lit.has(lamp.room)

    placeInstance(fixtures.shades, {
      x: lamp.at.x,
      y: lamp.shadeY,
      z: lamp.at.y,
      size: LAMP_SHADE_SIZE,
      color: isOn ? PROP_TONES.lampLit : PROP_TONES.lampOff,
    })

    if (!isOn) {
      continue
    }

    glowAt(fixtures.lampPools, {
      x: lamp.at.x,
      z: lamp.at.y,
      radius: LAMP_GLOW.poolRadius,
      rgb: LAMP_GLOW.poolRgb,
      alpha: 1,
    })
    glowAt(fixtures.halos, {
      x: lamp.at.x,
      y: lamp.shadeY,
      z: lamp.at.y,
      radius: LAMP_GLOW.haloSize / 2,
      rgb: LAMP_GLOW.haloRgb,
      alpha: glow.halo * lampGlow,
      tilt: -ELEVATION,
    })
  }
}

// The desk lamps' shades, lit with their room, each with a small pool under it in the lamp pools'
// strength.
function placeDeskLamps(fixtures: LampPools, frame: LampFrame): void {
  const { lit } = frame.sim.props

  for (const lamp of frame.props.deskLamps) {
    const isOn = lit.has(lamp.room)
    const [x, y, z] = lamp.at

    placeInstance(fixtures.shades, { x, y, z, size: lamp.size, color: isOn ? lamp.on : lamp.off })

    if (isOn) {
      glowAt(fixtures.lampPools, {
        x,
        z,
        radius: DESK_LAMP_POOL_RADIUS,
        rgb: WARM_RGB,
        alpha: 1,
      })
    }
  }
}

/** A soft round glow lying on the floor, or tilted to face the camera. */
export // Additive light: the instance colour is the light's colour times its strength.
function glowAt(
  pool: Pool,
  spec: {
    readonly x: number
    readonly y?: number
    readonly z: number
    readonly radius: number
    readonly rgb: string
    readonly alpha: number
    readonly tilt?: number
  }
): void {
  const [r = 0, g = 0, b = 0] = spec.rgb
    .split(',')
    .map((channel) => Math.round(Number(channel) * spec.alpha))

  placeInstance(pool, {
    x: spec.x,
    y: spec.y ?? POOL_Y,
    z: spec.z,
    size: [spec.radius * 2, spec.radius * 2, 1],
    tilt: spec.tilt ?? FLAT_TILT,
    color: `rgb(${r},${g},${b})`,
  })
}
