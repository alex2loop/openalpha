import { Color, type Vector3 } from 'three'

import type { SunView } from '@/web/scene/sky-types'
import type { RoomId } from '@/web/scene/types'
import { DEG } from '@/web/scene/clock/sun'

// The mockup's room levels: a lit room's fill and an unlit one's by day (the north rooms keep
// more of the glass's light) and by night, the floor outside the rooms at night, and the cool
// tint an unlit room takes, per channel.
const ROOM_LEVEL = Object.freeze({
  dayOn: 1,
  dayOffSouth: 0.16,
  dayOffNorth: 0.26,
  nightOn: 0.4,
  nightOff: 0.2,
  nightBase: 0.3,
  cool: [0.8, 1, 1.9],
  coolNight: [0.9, 1, 1.3],
} as const)
/** The sun is well under the horizon: the night light, levels and screens hold. */
export function isNightSun(sun: SunView): boolean {
  return sun.altitudeDeg < NIGHT_FROM_DEG
}

/** The floor outside the rooms at night. */
export const NIGHT_BASE = ROOM_LEVEL.nightBase

/** The office light at one sun altitude: the sky's and the ground's light, the hemisphere's and
 *  the environment's strength, the sun's colour and strength, the exposure, where the sun stands
 *  (three.js units round the floor's centre) and the sky's top and bottom, which tint the fog. */
export interface LightKey {
  readonly sky: Color
  readonly ground: Color
  readonly hemi: number
  readonly env: number
  readonly sun: Color
  readonly sunI: number
  readonly exposure: number
  readonly at: readonly [x: number, y: number, z: number]
  readonly top: Color
  readonly bottom: Color
}

/** One row of the mockup's light table: the sun altitude it holds at, then the key's values. */
type KeyRow = readonly [
  altitude: number,
  sky: number,
  ground: number,
  hemi: number,
  env: number,
  sun: number,
  sunI: number,
  exposure: number,
  x: number,
  y: number,
  z: number,
  top: number,
  bottom: number,
]

// The mockup's table: night under -9 degrees, dusk and dawn at -4, a red sun at the horizon,
// golden light to 8 degrees, flat neutral light from 40.
const NIGHT_ROW: KeyRow = [
  -9, 0x9aa6d6, 0x4a5272, 1.15, 0.4, 0xa9b6ee, 0.9, 1.05, -14, 38, 36, 0x1b2142, 0x313a62,
]
const KEY_ROWS: readonly KeyRow[] = [
  NIGHT_ROW,
  [-4, 0xc6a4b8, 0x7a6a7c, 0.7, 0.3, 0xc98aa8, 1.2, 1, 34, 8, 26, 0x6a5a86, 0xd99a84],
  [0, 0xffe2cc, 0xcdae98, 0.6, 0.32, 0xffa870, 2.1, 0.95, 34, 14, 26, 0xf2b994, 0xfce2c8],
  [8, 0xffebd6, 0xd5bfa6, 0.68, 0.36, 0xffcb90, 2.3, 0.93, 20, 28, 24, 0xfadfc2, 0xffeedb],
  [20, 0xfff6ea, 0xd8c3a8, 0.7, 0.38, 0xffdca8, 2.6, 0.92, -14, 32, 24, 0xd6e7f4, 0xfff2e0],
  [40, 0xfffaf2, 0xdccab2, 0.72, 0.4, 0xfff1d6, 2.4, 0.92, 0, 48, 18, 0xcfe4f5, 0xfff5e8],
]
// The sun stands this far out along its real bearing, between these altitudes, so a low sun
// never throws its shadows off the floor; under -8 degrees it has moved to the night key's moon.
const SUN_REACH = 48
const SUN_ANGLE_DEG = Object.freeze({ min: 12, max: 50 })
const MOON_FROM_DEG = -8
const NIGHT_FROM_DEG = -6
// Cloud and rain grey the sky, soften the sun and lift the sky light, less as the sun sets.
const OVERCAST = Object.freeze({
  cloud: 0.8,
  rain: 0.4,
  sky: 0xc8ccd2,
  skyShare: 0.3,
  hemiLift: 0.3,
  sun: 0xe8e6e2,
  sunShare: 0.5,
  sunCut: 0.62,
  top: 0x9aa3ae,
  topShare: 0.5,
  bottom: 0xbfc4ca,
  bottomShare: 0.4,
  fadeFromDeg: -2,
  fadeOverDeg: 10,
})

/** The light under `sun` with `cloud` and `rain` (each 0 to 1), as the mockup's `lightAt`. */
export function lightKeyOf(sun: SunView, weather: { cloud: number; rain: number }): LightKey {
  const alt = sun.altitudeDeg
  let i = 0

  while (i < KEY_ROWS.length - 2 && alt >= (KEY_ROWS[i + 1]?.[0] ?? Number.POSITIVE_INFINITY)) {
    i++
  }

  const a = KEY_ROWS[i] ?? NIGHT_ROW
  const b = KEY_ROWS[i + 1] ?? a
  const t = clamp((alt - a[0]) / (b[0] - a[0] || 1), 0, 1)
  const overcast =
    clamp(weather.cloud * OVERCAST.cloud + weather.rain * OVERCAST.rain, 0, 1) *
    clamp((alt - OVERCAST.fadeFromDeg) / OVERCAST.fadeOverDeg, 0, 1)
  const mix = (k: number): Color => new Color(a[k] ?? 0).lerp(new Color(b[k] ?? 0), t)
  const lerp = (k: number): number => (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * t

  return {
    sky: mix(1).lerp(new Color(OVERCAST.sky), OVERCAST.skyShare * overcast),
    ground: mix(2),
    hemi: lerp(3) * (1 + OVERCAST.hemiLift * overcast),
    env: lerp(4),
    sun: mix(5).lerp(new Color(OVERCAST.sun), OVERCAST.sunShare * overcast),
    sunI: lerp(6) * (1 - OVERCAST.sunCut * overcast),
    exposure: lerp(7),
    at: sunAt(sun),
    top: mix(11).lerp(new Color(OVERCAST.top), OVERCAST.topShare * overcast),
    bottom: mix(12).lerp(new Color(OVERCAST.bottom), OVERCAST.bottomShare * overcast),
  }
}

// A lit room holds its lamp's level, dimmed over the nap but never under the unlit level; an
// unlit one keeps the daylight through its glass, or the night floor.
export function roomLevelOf(
  room: { readonly id: RoomId; readonly rect: { readonly y: number } },
  at: { readonly lit: ReadonlySet<RoomId>; readonly lampGlow: number; readonly isNight: boolean }
): number {
  const { isNight } = at
  const on = isNight ? ROOM_LEVEL.nightOn : ROOM_LEVEL.dayOn
  const off = offLevel(room, isNight)

  return at.lit.has(room.id) ? Math.max(off, on * at.lampGlow) : off
}

// The fill per channel: the further under its lamp's level a room sits, the more of the cool
// glass light it takes.
export function setRoomFill(
  slot: Vector3 | undefined,
  at: {
    readonly room: { readonly rect: { readonly y: number } }
    readonly fill: number
    readonly isNight: boolean
  }
): void {
  const on = at.isNight ? ROOM_LEVEL.nightOn : ROOM_LEVEL.dayOn
  const off = offLevel(at.room, at.isNight)
  const cool = at.isNight ? ROOM_LEVEL.coolNight : ROOM_LEVEL.cool
  const share = on > off ? Math.min(1, Math.max(0, (on - at.fill) / (on - off))) : 0

  slot?.set(
    at.fill * (1 + (cool[0] - 1) * share),
    at.fill * (1 + (cool[1] - 1) * share),
    at.fill * (1 + (cool[2] - 1) * share)
  )
}

function offLevel(room: { readonly rect: { readonly y: number } }, isNight: boolean): number {
  if (isNight) {
    return ROOM_LEVEL.nightOff
  }

  return room.rect.y === 0 ? ROOM_LEVEL.dayOffNorth : ROOM_LEVEL.dayOffSouth
}

// The sun along its real bearing at a design altitude, blended into the night key's moon.
function sunAt(sun: SunView): LightKey['at'] {
  const day = clamp((sun.altitudeDeg - MOON_FROM_DEG) / -MOON_FROM_DEG, 0, 1)
  const angle = clamp(sun.altitudeDeg, SUN_ANGLE_DEG.min, SUN_ANGLE_DEG.max) * DEG
  const bearing = sun.azimuthDeg * DEG
  const ground = Math.cos(angle) * SUN_REACH
  const toward = [
    ground * Math.sin(bearing),
    Math.sin(angle) * SUN_REACH,
    -ground * Math.cos(bearing),
  ] as const
  const moon = [NIGHT_ROW[8], NIGHT_ROW[9], NIGHT_ROW[10]] as const

  return [
    moon[0] + (toward[0] - moon[0]) * day,
    moon[1] + (toward[1] - moon[1]) * day,
    moon[2] + (toward[2] - moon[2]) * day,
  ]
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}
