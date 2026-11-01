import { Color, PointLight, type Scene } from 'three'

import type { FloorProps } from '@/web/scene/render3d/props'
import type { Point, RoomId } from '@/web/scene/types'
import { toUnits } from '@/web/scene/render3d/space'
import { WORLD } from '@/web/scene/types'
import { view } from '@/web/scene/view'
import { roomById } from '@/web/scene/world/rooms'

/** The lamps' warm point lights; a spare one stays in the scene with no intensity, so the count
 *  every material compiled for never changes. `shown` is the lamp each light sits on and `glow`
 *  its brightness; `near` and `gaps` are scratch the pick reuses every frame. */
export interface Lamps {
  readonly lights: readonly PointLight[]
  readonly shown: (Lamp | undefined)[]
  readonly near: (Lamp | undefined)[]
  readonly gaps: number[]
  glow: number
  /** The floor the candidates were read from, and the lamps that can take a light there. */
  source: FloorProps | undefined
  candidates: readonly Lamp[]
}

/** A lamp that can hold a point light: its room, its foot and the light's look. */
interface Lamp {
  readonly room: RoomId
  readonly at: Point
  readonly look: LampLight
}

type LampLight = NonNullable<FloorProps['deskLamps'][number]['light']>

/** What the lamps follow: the floor's lamps, and the rooms lit and how bright. */
interface LampSpec {
  readonly props: FloorProps | undefined
  readonly lit: ReadonlySet<RoomId>
  readonly lampGlow: number
}

// More point lights cost every lit fragment; the nearest lit rooms take them.
const MAX_POINT_LIGHTS = 4
// The mockup's lamp light: a warm bulb under the shade's height, 48 strong, reaching 192 px.
const LAMP_LIGHT: LampLight = Object.freeze({
  tone: 0xffc870,
  intensity: 48,
  distancePx: 192,
  heightPx: 51.2,
})
const DECAY = 1.5
// The point the pick measures from, reused every frame.
const focus = { x: 0, y: 0 }

export function createLamps(scene: Scene): Lamps {
  const lights = Array.from(
    { length: MAX_POINT_LIGHTS },
    () => new PointLight(new Color(LAMP_LIGHT.tone), 0, toUnits(LAMP_LIGHT.distancePx), DECAY)
  )

  scene.add(...lights)

  return {
    lights,
    shown: Array.from({ length: MAX_POINT_LIGHTS }, () => undefined),
    near: Array.from({ length: MAX_POINT_LIGHTS }, () => undefined),
    gaps: Array.from({ length: MAX_POINT_LIGHTS }, () => Number.POSITIVE_INFINITY),
    glow: 0,
    source: undefined,
    candidates: [],
  }
}

/** Lights the lamps of the lit rooms nearest the room zoomed into, else the floor's middle,
 *  dimmed with the lamps; true when a light moved or changed. Allocates nothing. */
export function syncLamps(lamps: Lamps, spec: LampSpec): boolean {
  if (lamps.source !== spec.props) {
    lamps.source = spec.props
    lamps.candidates = candidatesOf(spec.props)
  }

  pickNearest(lamps, spec.lit)

  if (lamps.glow === spec.lampGlow && isSamePick(lamps)) {
    return false
  }

  lamps.glow = spec.lampGlow

  for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
    const lamp = lamps.near[i]
    const light = lamps.lights[i]

    lamps.shown[i] = lamp

    if (light !== undefined) {
      light.intensity = lamp === undefined ? 0 : lamp.look.intensity * spec.lampGlow
    }

    if (light !== undefined && lamp !== undefined) {
      light.color.setHex(lamp.look.tone)
      light.distance = toUnits(lamp.look.distancePx)
      light.position.set(toUnits(lamp.at.x), toUnits(lamp.look.heightPx), toUnits(lamp.at.y))
    }
  }

  return true
}

// The floor lamps in the mockup's light, then the desk lamps that carry one of their own.
function candidatesOf(props: FloorProps | undefined): readonly Lamp[] {
  const floorLamps = (props?.lamps ?? []).map((lamp) => ({ ...lamp, look: LAMP_LIGHT }))
  const deskLamps = (props?.deskLamps ?? []).flatMap((lamp) =>
    lamp.light === undefined
      ? []
      : [{ room: lamp.room, at: { x: lamp.at[0], y: lamp.at[2] }, look: lamp.light }]
  )

  return [...floorLamps, ...deskLamps]
}

// Never the gliding camera's centre: a pick that followed it moved lights between rooms through
// a zoom or pan, and the floor and walls flickered.
function placeFocus(): void {
  const held = view.value.room
  const rect = held === undefined ? undefined : roomById(held)?.rect

  focus.x = rect === undefined ? WORLD.w / 2 : rect.x + rect.w / 2
  focus.y = rect === undefined ? WORLD.h / 2 : rect.y + rect.h / 2
}

// Keeps the nearest lit lamps in `near`, nearest first; a tie keeps the props' order.
function pickNearest(lamps: Lamps, lit: ReadonlySet<RoomId>): void {
  const { near, gaps } = lamps

  placeFocus()

  near.fill(undefined)
  gaps.fill(Number.POSITIVE_INFINITY)

  for (const lamp of lamps.candidates) {
    if (!lit.has(lamp.room)) {
      continue
    }

    const gap = Math.hypot(lamp.at.x - focus.x, lamp.at.y - focus.y)
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
