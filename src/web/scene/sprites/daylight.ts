import type { FloorId, RoomId } from '@/web/scene/types'

/** One row of the office light: from its hour, the tint over the floor (none by day), how
 *  strongly lamps and pools glow, and the sky's top and bottom colours. */
export interface LightRow {
  readonly fromHour: number
  readonly tint?: string
  readonly glow: number
  readonly sky: readonly [string, string]
}

/** The office light through the day, by the page hour; a row holds until the next one starts. */
const LIGHT_BY_HOUR: readonly LightRow[] = Object.freeze([
  { fromHour: 0, tint: 'rgba(14,18,44,.46)', glow: 0.42, sky: ['#1B2142', '#313A62'] },
  { fromHour: 5.5, tint: 'rgba(255,170,110,.16)', glow: 0.28, sky: ['#F2B994', '#FCE2C8'] },
  { fromHour: 7.5, glow: 0.12, sky: ['#CFE4F5', '#FFF5E8'] },
  { fromHour: 16.75, tint: 'rgba(255,128,60,.18)', glow: 0.3, sky: ['#6A5A86', '#D99A84'] },
  { fromHour: 18.5, tint: 'rgba(14,18,44,.46)', glow: 0.42, sky: ['#1B2142', '#313A62'] },
])
/** The hour whose light the office keeps when its light does not follow the page hour. */
export const DAY_LIGHT_HOUR = 12
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
/** The lobby's red glow after an index drop: x, y, radius. */
export const DROP_POOL: readonly [number, number, number] = Object.freeze([60, 292, 70])
/** The room that dims once the home market has shut for the day. */
export const CLOSED_ROOM: RoomId = 'lobby'
// The drop glow is full at this session move (percent).
const DROP_FULL_PCT = 3
const DROP_MAX_ALPHA = 0.34

/** The light of `hour`. */
export function lightAt(hour: number): LightRow {
  const row = LIGHT_BY_HOUR.findLast((candidate) => hour >= candidate.fromHour) ?? LIGHT_BY_HOUR[0]

  return row ?? { fromHour: 0, glow: 0, sky: ['#CFE4F5', '#FFF5E8'] }
}

/** How strongly the lobby glows red after a session move of `dropPct` percent. */
export function dropAlphaOf(dropPct: number): number {
  return Math.min(1, Math.abs(dropPct) / DROP_FULL_PCT) * DROP_MAX_ALPHA
}
