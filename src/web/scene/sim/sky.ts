import { computed, type ReadonlySignal } from '@preact/signals'

import type { WeatherFxView, WindowLight } from '@/web/scene/sky-types'
import type { LightView } from '@/web/scene/types'
import { pageMinute, pageNow, sceneZone } from '@/web/scene/clock/clock'
import { solarNoonOf, sunAt } from '@/web/scene/clock/sun'
import { regionPack } from '@/web/scene/data/home'
import { weather } from '@/web/scene/data/weather'
import { AT_ONCE, createFade, frameGapOf } from '@/web/scene/sim/ease'
import { createWindowEase } from '@/web/scene/sim/window-ease'
import { lightByHour } from '@/web/state/prefs'
import { zoneParts } from '@/web/text/time'

const LIGHT_EASE_MS = 2_000
// The lamps' glow fades to its nap level or back with this time constant.
const LAMP_GLOW_TAU_MS = 500
const FULL_TURN_DEG = 360
const HALF_TURN_DEG = 180
// A step this small (the sun's drift over a page minute) lands at once, so a still office stays
// still; a jump of a preview hour or a new reading eases.
const SNAP_UNDER = Object.freeze({ altitudeDeg: 1, azimuthDeg: 2, cloud: 0.05 })

/** The light the clock asks for, read once a page minute: the sun and the cloud now, or the sun
 *  held at solar noon under a clear sky when the light does not follow the hour; `minute` is the
 *  minute of the day that light belongs to. */
export interface SkyNow {
  readonly light: LightView
  readonly minute: number
}

export const skyNow: ReadonlySignal<SkyNow> = computed(() => {
  const { day, minute } = pageMinute.value
  const { geo } = regionPack.value

  if (!lightByHour.value) {
    const noonMs = solarNoonOf(day, geo)

    return {
      light: { sun: sunAt(noonMs, geo), cloud: 0, followsHour: false },
      minute: zoneParts(noonMs, sceneZone.value).minute,
    }
  }

  return {
    light: { sun: sunAt(pageNow(), geo), cloud: weather.value.cloud, followsHour: true },
    minute,
  }
})

/** The light the renderers draw: `skyNow` eased over `LIGHT_EASE_MS` from where it stood, at once
 *  under reduced motion. `view` fills one object in place. `windowLight` is the window light under
 *  the sun and cloud `skyNow` asks for (not the eased ones, so a jump eases once) and the weather
 *  `fx`, its patches and blinds easing on the same clock, and `glow` the lamps' glow `target`
 *  faded the same way; `isEasing` covers all three. */
export interface SkyEase {
  view(nowMs: number, isReduced: boolean): LightView
  windowLight(fx: WeatherFxView): WindowLight
  glow(target: number): number
  isEasing(nowMs: number): boolean
}

interface Shown {
  readonly sun: { altitudeDeg: number; azimuthDeg: number }
  cloud: number
  followsHour: boolean
}

export function createSkyEase(): SkyEase {
  const first = skyNow.peek().light
  const shown: Shown = {
    sun: { ...first.sun },
    cloud: first.cloud,
    followsHour: first.followsHour,
  }
  const from = { altitudeDeg: 0, azimuthDeg: 0, cloud: 0 }
  const glass = createWindowEase()
  const lamps = createFade(LAMP_GLOW_TAU_MS)
  let target = first
  let startedAt = Number.NEGATIVE_INFINITY
  let lastMs: number | undefined
  let dtMs = AT_ONCE

  return {
    view(nowMs, isReduced) {
      dtMs = frameGapOf({ nowMs, lastMs, isReduced })
      lastMs = nowMs

      const next = skyNow.value.light

      if (next !== target) {
        from.altitudeDeg = shown.sun.altitudeDeg
        from.azimuthDeg = shown.sun.azimuthDeg
        from.cloud = shown.cloud
        target = next
        startedAt = isReduced || isSmallStep(from, next) ? Number.NEGATIVE_INFINITY : nowMs
      }

      const k = Math.min(1, Math.max(0, (nowMs - startedAt) / LIGHT_EASE_MS))
      const eased = k * k * (3 - 2 * k)
      const turn = turnOf(from.azimuthDeg, next.sun.azimuthDeg)

      shown.sun.altitudeDeg = from.altitudeDeg + (next.sun.altitudeDeg - from.altitudeDeg) * eased
      shown.sun.azimuthDeg = (from.azimuthDeg + turn * eased + FULL_TURN_DEG) % FULL_TURN_DEG
      shown.cloud = from.cloud + (next.cloud - from.cloud) * eased
      shown.followsHour = next.followsHour

      return shown
    },
    windowLight: (fx) => glass.view({ dtMs, sun: target.sun, cloud: target.cloud, rain: fx.rain }),
    glow: (to) => lamps.view(to, dtMs),
    isEasing: (nowMs) => nowMs - startedAt < LIGHT_EASE_MS || glass.isEasing() || lamps.isMoving(),
  }
}

function isSmallStep(
  from: { readonly altitudeDeg: number; readonly azimuthDeg: number; readonly cloud: number },
  next: LightView
): boolean {
  const turn = Math.abs(next.sun.azimuthDeg - from.azimuthDeg) % FULL_TURN_DEG

  return (
    Math.abs(next.sun.altitudeDeg - from.altitudeDeg) < SNAP_UNDER.altitudeDeg &&
    Math.min(turn, FULL_TURN_DEG - turn) < SNAP_UNDER.azimuthDeg &&
    Math.abs(next.cloud - from.cloud) < SNAP_UNDER.cloud
  )
}

// The signed turn from one bearing to another by the shorter way round, -180 to 180 degrees.
function turnOf(fromDeg: number, toDeg: number): number {
  return (
    ((((toDeg - fromDeg) % FULL_TURN_DEG) + FULL_TURN_DEG + HALF_TURN_DEG) % FULL_TURN_DEG) -
    HALF_TURN_DEG
  )
}
