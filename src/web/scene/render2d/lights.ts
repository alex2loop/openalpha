import type { FloorId, RoomId } from '@/web/scene/types'
import { fill } from '@/web/scene/render2d/building'
import {
  ALERT_RGB,
  CLOSED_ROOM,
  DROP_POOL,
  dropAlphaOf,
  type LightRow,
  TABLE_POOLS,
  WARM_RGB,
} from '@/web/scene/sprites/daylight'
import { propsOn } from '@/web/scene/world/props'
import { roomAt, roomsOn, WALL_BAND_PX } from '@/web/scene/world/rooms'

// A lit room keeps this share of the night's tint.
const LIT_NIGHT_SHARE = 0.45
const UNLIT_SHADE = '#A4A8BC'
const UNLIT_NORTH_SHADE = '#CDD0DA'
const LAMP_HEAD_RADIUS = 28
const LAMP_FLOOR_RADIUS = 48
const LAMP_HEAD_ALPHA = 0.36
const LAMP_FLOOR_ALPHA = 0.34
const CLOSED_SHADE = '#C4C6D2'

interface LightingSpec {
  readonly floor: FloorId
  readonly lit: ReadonlySet<RoomId>
  readonly light: LightRow
  /** The index's session move behind the lobby's red glow, a percent; absent without one. */
  readonly dropPct?: number
  /** How far the lamps that are on glow: 1 untouched, less over the lunch nap. */
  readonly lampGlow: number
  /** The home market has shut for the day: the lobby dims. */
  readonly isClosed: boolean
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

    const shade = shadeOf(spec, { room: room.id, isLit, isNorth })

    if (shade !== undefined) {
      g.globalCompositeOperation = 'multiply'
      fill(g, box, shade)
      g.globalCompositeOperation = 'source-over'
    }
  }
}

// An unlit room darkens; a lit lobby still dims once the home market has shut.
function shadeOf(
  spec: LightingSpec,
  at: { readonly room: RoomId; readonly isLit: boolean; readonly isNorth: boolean }
): string | undefined {
  if (!at.isLit) {
    return at.isNorth ? UNLIT_NORTH_SHADE : UNLIT_SHADE
  }

  return spec.isClosed && at.room === CLOSED_ROOM ? CLOSED_SHADE : undefined
}

function paintPools(g: CanvasRenderingContext2D, spec: LightingSpec, glow: number): void {
  for (const [x, y, radius] of TABLE_POOLS[spec.floor]) {
    const room = roomAt(spec.floor, { x, y })

    if (room !== undefined && spec.lit.has(room.id)) {
      pool(g, { x, y, radius, rgb: WARM_RGB, alpha: glow * spec.lampGlow })
    }
  }

  for (const prop of propsOn(spec.floor).filter(
    (each) => each.kind === 'lamp' && spec.lit.has(each.room)
  )) {
    const rect = prop.draw
    const cx = rect.x + rect.w / 2

    pool(g, {
      x: cx,
      y: rect.y + 4,
      radius: LAMP_HEAD_RADIUS,
      rgb: WARM_RGB,
      alpha: LAMP_HEAD_ALPHA * spec.lampGlow,
    })
    pool(g, {
      x: cx,
      y: rect.y + rect.h,
      radius: LAMP_FLOOR_RADIUS,
      rgb: WARM_RGB,
      alpha: LAMP_FLOOR_ALPHA * spec.lampGlow,
    })
  }

  if (spec.floor === 'office' && spec.dropPct !== undefined) {
    const [x, y, radius] = DROP_POOL

    pool(g, { x, y, radius, rgb: ALERT_RGB, alpha: dropAlphaOf(spec.dropPct) })
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
