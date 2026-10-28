import type { FloorId, LightView, RoomId } from '@/web/scene/types'
import { isMorningSun } from '@/web/scene/clock/sun'

/** The office light now: the tint over the floor (none by day), how strongly lamps and pools
 *  glow, the sky's top and bottom colours, and how dark it is outside (0 day, 1 night). */
export interface LightRow {
  readonly tint?: string
  readonly glow: number
  readonly sky: readonly [string, string]
  readonly dark: number
}

/** One key of the light by the sun: the tint as red, green, blue and alpha, the glow, the sky's
 *  two colours and the darkness. */
interface LightKey {
  readonly tint: readonly [number, number, number, number]
  readonly glow: number
  readonly sky: readonly [string, string]
  readonly dark: number
}

const NIGHT: LightKey = {
  tint: [14, 18, 44, 0.46],
  glow: 0.42,
  sky: ['#1B2142', '#313A62'],
  dark: 1,
}
const DAWN: LightKey = {
  tint: [255, 170, 110, 0.16],
  glow: 0.28,
  sky: ['#F2B994', '#FCE2C8'],
  dark: 0.45,
}
const DUSK: LightKey = {
  tint: [255, 128, 60, 0.18],
  glow: 0.3,
  sky: ['#6A5A86', '#D99A84'],
  dark: 0.45,
}
const DAY: LightKey = { tint: [255, 255, 255, 0], glow: 0.12, sky: ['#CFE4F5', '#FFF5E8'], dark: 0 }
// Night below the civil twilight's -6 degrees, the golden hour under 10.
const NIGHT_BELOW_DEG = -6
const GOLDEN_BELOW_DEG = 10
// A full cloud cover greys the tint and the sky and darkens the day a little.
const CLOUD = Object.freeze({
  tint: [96, 104, 124] as const,
  alpha: 0.12,
  sky: ['#9EA8B8', '#CDD2DA'] as const,
  skyShare: 0.55,
  dark: 0.12,
})
// Below this alpha the tint is left off.
const TINT_MIN_ALPHA = 0.005
// The row is reused while the sun moves less than this and the cloud less than its own step.
const ALTITUDE_STEP_DEG = 0.05
const CLOUD_STEP = 0.01
let lastKey = Number.NaN
let lastRow: LightRow = toRow(DAY, 0)

/** The lamps' and table pools' warm light, and the lobby's red after an index drop. */
export const WARM_RGB = '255,226,180'
export const ALERT_RGB = '229,72,77'
/** Warm pools over the tables, lit while the room's lamp is on: x, y, radius. */
export const TABLE_POOLS: Readonly<
  Record<FloorId, readonly (readonly [number, number, number])[]>
> = Object.freeze({
  office: [
    [512, 124, 72],
    [244, 96, 64],
    [80, 110, 56],
    [558, 300, 48],
    [400, 300, 44],
    [240, 300, 44],
    [60, 280, 56],
  ],
  team: [
    [107, 200, 70],
    [320, 200, 70],
    [533, 200, 70],
  ],
})
/** The monitors' cool light, and where it falls on the office desks: x, y, radius. */
export const SCREEN_RGB = '150,205,255'
export const SCREEN_POOLS: readonly (readonly [number, number, number])[] = Object.freeze([
  [182, 120, 16],
  [230, 120, 16],
  [278, 120, 16],
  [528, 292, 16],
  [560, 292, 16],
  [370, 292, 16],
  [58, 338, 34],
])
/** The lobby's red glow after an index drop: x, y, radius. */
export const DROP_POOL: readonly [number, number, number] = Object.freeze([60, 292, 70])
/** The room that dims once the home market has shut for the day. */
export const CLOSED_ROOM: RoomId = 'lobby'
// The drop glow is full at this session move (percent).
const DROP_FULL_PCT = 3
const DROP_MAX_ALPHA = 0.34

/** The office light under `light`'s sun and cloud: night below -6 degrees, civil twilight to the
 *  horizon, the golden hour under 10 degrees in the dawn's or the dusk's colours, then day; cloud
 *  greys the tint and the sky. */
export function lightOf(light: LightView): LightRow {
  const { altitudeDeg } = light.sun
  const isMorning = isMorningSun(light.sun)
  const altitudeStep = Math.round(altitudeDeg / ALTITUDE_STEP_DEG)
  const key =
    (altitudeStep * 2 + (isMorning ? 1 : 0)) * (1 / CLOUD_STEP + 1) +
    Math.round(light.cloud / CLOUD_STEP)

  if (key !== lastKey) {
    lastKey = key
    lastRow = toRow(keyAt(altitudeDeg, isMorning), light.cloud)
  }

  return lastRow
}

function keyAt(altitudeDeg: number, isMorning: boolean): LightKey {
  const golden = isMorning ? DAWN : DUSK

  if (altitudeDeg <= NIGHT_BELOW_DEG) {
    return NIGHT
  }

  if (altitudeDeg < 0) {
    return mixKey(NIGHT, golden, (altitudeDeg - NIGHT_BELOW_DEG) / -NIGHT_BELOW_DEG)
  }

  return altitudeDeg < GOLDEN_BELOW_DEG ? mixKey(golden, DAY, altitudeDeg / GOLDEN_BELOW_DEG) : DAY
}

function mixKey(a: LightKey, b: LightKey, k: number): LightKey {
  return {
    tint: [
      mix(a.tint[0], b.tint[0], k),
      mix(a.tint[1], b.tint[1], k),
      mix(a.tint[2], b.tint[2], k),
      mix(a.tint[3], b.tint[3], k),
    ],
    glow: mix(a.glow, b.glow, k),
    sky: [mixHex(a.sky[0], b.sky[0], k), mixHex(a.sky[1], b.sky[1], k)],
    dark: mix(a.dark, b.dark, k),
  }
}

// Cloud greys the tint toward its own hue and deepens it, by day only.
function toRow(key: LightKey, cloud: number): LightRow {
  const grey = cloud * (1 - key.dark)
  const [r, g, b, a] = key.tint
  const alpha = a + grey * CLOUD.alpha
  const rgb = [
    mix(r, CLOUD.tint[0], grey),
    mix(g, CLOUD.tint[1], grey),
    mix(b, CLOUD.tint[2], grey),
  ]
  const skyShare = cloud * CLOUD.skyShare

  return {
    ...(alpha < TINT_MIN_ALPHA
      ? {}
      : { tint: `rgba(${rgb.map(Math.round).join(',')},${alpha.toFixed(3)})` }),
    glow: key.glow,
    sky: [mixHex(key.sky[0], CLOUD.sky[0], skyShare), mixHex(key.sky[1], CLOUD.sky[1], skyShare)],
    dark: Math.min(1, key.dark + grey * CLOUD.dark),
  }
}

function mix(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

function mixHex(a: string, b: string, k: number): string {
  if (k <= 0) {
    return a
  }

  const from = Number.parseInt(a.slice(1), 16)
  const to = Number.parseInt(b.slice(1), 16)
  let out = 0

  for (const shift of [16, 8, 0]) {
    out |= Math.round(mix((from >> shift) & 0xff, (to >> shift) & 0xff, k)) << shift
  }

  return `#${out.toString(16).padStart(6, '0')}`
}

/** How strongly the lobby glows red after a session move of `dropPct` percent. */
export function dropAlphaOf(dropPct: number): number {
  return Math.min(1, Math.abs(dropPct) / DROP_FULL_PCT) * DROP_MAX_ALPHA
}
