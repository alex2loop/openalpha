import type { FloorId, RoomId } from '@/web/scene/types'
import { fill } from '@/web/scene/render2d/building'
import { propsOn } from '@/web/scene/world/props'
import { roomAt, roomsOn, WALL_BAND_PX } from '@/web/scene/world/rooms'

interface LightRow {
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
// A lit room keeps this share of the night's tint.
const LIT_NIGHT_SHARE = 0.45
const UNLIT_SHADE = '#A4A8BC'
const UNLIT_NORTH_SHADE = '#CDD0DA'
const WARM = '255,226,180'
const ALERT_RED = '229,72,77'
const LAMP_HEAD_RADIUS = 28
const LAMP_FLOOR_RADIUS = 48
const LAMP_HEAD_ALPHA = 0.36
const LAMP_FLOOR_ALPHA = 0.34
// Warm pools over the tables, lit while the room's lamp is on: x, y, radius.
const TABLE_POOLS: Readonly<Record<FloorId, readonly (readonly [number, number, number])[]>> =
  Object.freeze({
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
// The lobby's red glow after an index drop: full at this session move (percent).
const DROP_FULL_PCT = 3
const DROP_MAX_ALPHA = 0.34
const DROP_POOL: readonly [number, number, number] = [60, 292, 70]

/** The light of `hour`: a tint over the floor (none by day), how strongly lamps and pools glow, and
 *  the sky's top and bottom colours. */
export function lightAt(hour: number): LightRow {
  const row = LIGHT_BY_HOUR.findLast((candidate) => hour >= candidate.fromHour) ?? LIGHT_BY_HOUR[0]

  return row ?? { fromHour: 0, glow: 0, sky: ['#CFE4F5', '#FFF5E8'] }
}

interface LightingSpec {
  readonly floor: FloorId
  readonly lit: ReadonlySet<RoomId>
  readonly light: LightRow
  /** The index's session move behind the lobby's red glow, a percent; absent without one. */
  readonly dropPct?: number
}

/** One light pass over the sprites: each room's tint and darkness, then the warm pools in
 *  `lighter` blend. */
export function paintLighting(g: CanvasRenderingContext2D, spec: LightingSpec): void {
  paintRoomShade(g, spec)
  g.globalCompositeOperation = 'lighter'
  paintPools(g, spec, spec.light.glow)
  g.globalCompositeOperation = 'source-over'
}

function paintRoomShade(g: CanvasRenderingContext2D, spec: LightingSpec): void {
  const { tint } = spec.light

  for (const room of roomsOn(spec.floor)) {
    const { x, y, w, h } = room.rect
    const isNorth = y === 0
    const box = [x, isNorth ? WALL_BAND_PX - 4 : y, w, isNorth ? h - WALL_BAND_PX + 4 : h] as const
    const isLit = spec.lit.has(room.id)

    if (tint !== undefined) {
      g.globalAlpha = isLit ? LIT_NIGHT_SHARE : 1
      fill(g, box, tint)
      g.globalAlpha = 1
    }

    if (!isLit) {
      g.globalCompositeOperation = 'multiply'
      fill(g, box, isNorth ? UNLIT_NORTH_SHADE : UNLIT_SHADE)
      g.globalCompositeOperation = 'source-over'
    }
  }
}

function paintPools(g: CanvasRenderingContext2D, spec: LightingSpec, glow: number): void {
  for (const [x, y, radius] of TABLE_POOLS[spec.floor]) {
    const room = roomAt(spec.floor, { x, y })

    if (room !== undefined && spec.lit.has(room.id)) {
      pool(g, { x, y, radius, rgb: WARM, alpha: glow })
    }
  }

  for (const lamp of propsOn(spec.floor).filter(
    (prop) => prop.kind === 'lamp' && spec.lit.has(prop.room)
  )) {
    const cx = lamp.rect.x + lamp.rect.w / 2

    pool(g, {
      x: cx,
      y: lamp.rect.y + 4,
      radius: LAMP_HEAD_RADIUS,
      rgb: WARM,
      alpha: LAMP_HEAD_ALPHA,
    })
    pool(g, {
      x: cx,
      y: lamp.rect.y + lamp.rect.h,
      radius: LAMP_FLOOR_RADIUS,
      rgb: WARM,
      alpha: LAMP_FLOOR_ALPHA,
    })
  }

  if (spec.floor === 'office' && spec.dropPct !== undefined) {
    const [x, y, radius] = DROP_POOL
    const alpha = Math.min(1, Math.abs(spec.dropPct) / DROP_FULL_PCT) * DROP_MAX_ALPHA

    pool(g, { x, y, radius, rgb: ALERT_RED, alpha })
  }
}

interface Pool {
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly rgb: string
  readonly alpha: number
}

function pool(g: CanvasRenderingContext2D, spec: Pool): void {
  const gradient = g.createRadialGradient(spec.x, spec.y, 0, spec.x, spec.y, spec.radius)

  gradient.addColorStop(0, `rgba(${spec.rgb},${spec.alpha})`)
  gradient.addColorStop(1, `rgba(${spec.rgb},0)`)
  g.fillStyle = gradient
  g.fillRect(spec.x - spec.radius, spec.y - spec.radius, spec.radius * 2, spec.radius * 2)
}
