import type { GlassSide, SunView, WindowLight } from '@/web/scene/sky-types'
import { DEG } from '@/web/scene/clock/sun'

export const GLASS_SIDES: readonly GlassSide[] = Object.freeze(['w', 'e', 'n', 's'])

// The mockup's rules: the sun lights a side it faces, more as it climbs to 4 degrees and less under
// cloud and rain; a low sun facing the west or east glass draws its blinds; the patch reaches as
// deep as a wall's height casts at the sun's altitude.
const OVERCAST = Object.freeze({ cloud: 0.9, rain: 0.4 })
const DIRECT_FULL_DEG = 4
const BLIND = Object.freeze({
  aboveDeg: -1,
  belowDeg: 32,
  facing: 0.35,
  underOvercast: 0.75,
  from: 0.2,
  span: 0.4,
  least: 0.5,
})
/** The share of a patch that fully drawn blinds take away. */
export const BLIND_CUT = 0.85
const WALL_PX = 36
const DEPTH = Object.freeze({ lowestDeg: 3, min: 10, max: 95 })

/** The window light `sun` with `cloud` and `rain` (each 0 to 1) asks for. */
export function windowLightOf(
  sun: SunView,
  weather: { readonly cloud: number; readonly rain: number }
): WindowLight {
  const alt = sun.altitudeDeg
  const sx = Math.sin(sun.azimuthDeg * DEG)
  const sz = -Math.cos(sun.azimuthDeg * DEG)
  const overcast = clamp(weather.cloud * OVERCAST.cloud + weather.rain * OVERCAST.rain, 0, 1)
  const direct = clamp(alt / DIRECT_FULL_DEG, 0, 1) * (1 - overcast)
  const facing: Record<GlassSide, number> = {
    w: Math.max(0, -sx),
    e: Math.max(0, sx),
    n: Math.max(0, -sz),
    s: Math.max(0, sz),
  }
  const blindOf = (side: 'w' | 'e'): number => {
    const e = facing[side]
    const isLow = alt > BLIND.aboveDeg && alt < BLIND.belowDeg

    return isLow && e > BLIND.facing && overcast < BLIND.underOvercast
      ? clamp((e - BLIND.from) / BLIND.span, BLIND.least, 1)
      : 0
  }
  const blind = { w: blindOf('w'), e: blindOf('e') }
  const depth = clamp(
    WALL_PX / Math.tan(Math.max(alt, DEPTH.lowestDeg) * DEG),
    DEPTH.min,
    DEPTH.max
  )

  return {
    blind,
    patch: {
      w: facing.w * direct,
      e: facing.e * direct,
      n: facing.n * direct,
      s: facing.s * direct,
    },
    depth: { w: depth, e: depth, n: depth, s: depth },
  }
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}
