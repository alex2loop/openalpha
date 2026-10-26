import { AdditiveBlending, type Group, MeshBasicMaterial, NormalBlending } from 'three'

import type { Standing } from '@/web/scene/render3d/characters'
import type { Materials } from '@/web/scene/render3d/lights'
import type { FloorProps } from '@/web/scene/render3d/props'
import type { SimView } from '@/web/scene/types'
import {
  beginPool,
  createPool,
  endPool,
  type Pool,
  placeInstance,
  type Shapes,
} from '@/web/scene/render3d/instancing'
import { isNightSun } from '@/web/scene/render3d/light-model'
import { LAMP_SHADE_SIZE } from '@/web/scene/render3d/props'
import {
  ALERT_RGB,
  DROP_POOL,
  dropAlphaOf,
  type LightRow,
  TABLE_POOLS,
  WARM_RGB,
} from '@/web/scene/sprites/daylight'
import { OUTLINE, PROP_TONES } from '@/web/scene/sprites/palette'
import { ELEVATION } from '@/web/scene/view'
import { DESK_SLOTS } from '@/web/scene/world/floors'
import { roomAt } from '@/web/scene/world/rooms'

/** What lights up, glows and marks people: screens, lamp shades, light pools, contact shadows,
 *  the status dots and the selection ring; each kind one instanced mesh. */
export interface Fixtures {
  readonly screens: Pool
  readonly backs: Pool
  readonly shades: Pool
  readonly warm: Pool
  readonly cool: Pool
  readonly lampPools: Pool
  /** The lamp pools' own material: blended over the floor by day, added to it by night. */
  readonly lampGlow: MeshBasicMaterial
  readonly halos: Pool
  readonly shadows: Pool
  readonly dots: Pool
  readonly ring: Pool
  readonly owned: readonly { dispose(): void }[]
}

/** What the fixtures read this frame besides the snapshot. */
interface FixtureFrame {
  readonly sim: SimView
  readonly props: FloorProps
  readonly standing: readonly Standing[]
  readonly row: LightRow
  readonly selected: string | undefined
  readonly dropPct: number | undefined
  /** CSS px per world px: a status dot keeps its size on screen. */
  readonly scale: number
}

const MAX_SCREENS = 24
const MAX_LAMPS = 16
const MAX_POOLS = 16
const MAX_PEOPLE = 48
const COOL_RGB = '120,160,255'
const SHADOW_TONE = '#4A3A44'
const SHADOW_OPACITY = 0.5
const SHADOW_SIZE: readonly [number, number, number] = [16, 12, 1]
// A worker this close to a screen's seat lights it.
const SCREEN_REACH_PX = 12
// Transparent pools by kind, each over the last: table light, desk glow, lamp light.
const ORDER = Object.freeze({ shadow: 1, warm: 2, cool: 2.1, lamp: 2.2, halo: 2.3, dot: 6 })
const POOL_Y = 0.5
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
const DESK_GLOW = Object.freeze({ dx: 20, dy: -6, radius: 28, alpha: 0.32 })
const DOT_RISE_PX = 6
const MONITOR_BACK = '#2A2F3F'
// The mockup's 3D status dots: green free, amber waiting, red after an error.
const DOT_TONES = Object.freeze({ free: '#32D74B', waiting: '#F2B33D', failed: '#FF6259' })
const DOT_PX = Object.freeze({ max: 3.4, min: 1.5, screen: 5 })
const RING = Object.freeze({ w: 16, d: 10, h: 0.3 })
const FLAT_TILT = -Math.PI / 2

export function createFixtures(shapes: Shapes, materials: Materials, root: Group): Fixtures {
  const glow = new MeshBasicMaterial({
    map: shapes.glow,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  })
  const shadow = new MeshBasicMaterial({
    map: shapes.glow,
    color: SHADOW_TONE,
    transparent: true,
    opacity: SHADOW_OPACITY,
    depthWrite: false,
    toneMapped: false,
  })
  const lampGlow = new MeshBasicMaterial({
    map: shapes.glow,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    toneMapped: false,
  })
  const dot = new MeshBasicMaterial({ vertexColors: true, toneMapped: false })
  const ink = new MeshBasicMaterial({ color: OUTLINE, toneMapped: false })
  const fixtures: Fixtures = {
    screens: createPool(shapes.box, materials.unlitI, { cap: MAX_SCREENS }),
    backs: createPool(shapes.box, materials.litI, { cap: MAX_SCREENS }),
    shades: createPool(shapes.box, materials.unlitI, { cap: MAX_LAMPS }),
    warm: createPool(shapes.flat, glow, { cap: MAX_POOLS, order: ORDER.warm }),
    cool: createPool(shapes.flat, glow, { cap: MAX_POOLS, order: ORDER.cool }),
    lampPools: createPool(shapes.flat, lampGlow, { cap: MAX_LAMPS, order: ORDER.lamp }),
    lampGlow,
    halos: createPool(shapes.flat, glow, { cap: MAX_LAMPS, order: ORDER.halo }),
    shadows: createPool(shapes.flat, shadow, { cap: MAX_PEOPLE, order: ORDER.shadow }),
    dots: createPool(shapes.dot, dot, { cap: MAX_PEOPLE, order: ORDER.dot }),
    ring: createPool(shapes.box, ink, { cap: 1 }),
    owned: [glow, lampGlow, shadow, dot, ink],
  }

  root.add(...poolsOf(fixtures).map((pool) => pool.mesh))

  return fixtures
}

/** Rewrites the fixtures whose picture changed; true when one did. */
export function syncFixtures(fixtures: Fixtures, frame: FixtureFrame): boolean {
  const changes = [
    syncScreens(fixtures.screens, frame),
    syncBacks(fixtures.backs, frame),
    syncLamps(fixtures, frame),
    syncWarm(fixtures.warm, frame),
    syncCool(fixtures.cool, frame),
    syncPeople(fixtures, frame),
  ]

  return changes.some(Boolean)
}

export function disposeFixtures(fixtures: Fixtures): void {
  for (const pool of poolsOf(fixtures)) {
    pool.mesh.dispose()
  }

  for (const one of fixtures.owned) {
    one.dispose()
  }
}

function poolsOf(fixtures: Fixtures): Pool[] {
  const { screens, backs, shades, warm, cool, lampPools, halos, shadows, dots, ring } = fixtures

  return [screens, backs, shades, warm, cool, lampPools, halos, shadows, dots, ring]
}

function syncScreens(pool: Pool, frame: FixtureFrame): boolean {
  const lit = frame.props.screens.map((screen) =>
    frame.standing.some(
      ({ actor, at }) =>
        actor.working && Math.hypot(at.x - screen.seat.x, at.y - screen.seat.y) <= SCREEN_REACH_PX
    )
  )

  const idle = frame.sim.life.isQuiet ? PROP_TONES.screenOff : PROP_TONES.screenStandby

  if (!beginPool(pool, `${frame.sim.floor}|${idle}|${lit.join()}`)) {
    return false
  }

  frame.props.screens.forEach((screen, i) => {
    const [x, y, z] = screen.at

    placeInstance(pool, {
      x,
      y,
      z,
      size: screen.size,
      tilt: screen.tilt,
      color: lit[i] === true ? PROP_TONES.screenLit : idle,
    })
  })
  endPool(pool)

  return true
}

// The monitors' backs lean with their faces; they change only with the floor.
function syncBacks(pool: Pool, frame: FixtureFrame): boolean {
  if (!beginPool(pool, frame.sim.floor)) {
    return false
  }

  for (const { back, tilt } of frame.props.screens) {
    const [x, y, z] = back.at

    placeInstance(pool, { x, y, z, size: back.size, tilt, color: MONITOR_BACK })
  }

  endPool(pool)

  return true
}

function syncLamps(fixtures: Fixtures, frame: FixtureFrame): boolean {
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
  fixtures: Fixtures,
  at: { readonly frame: FixtureFrame; readonly isNight: boolean }
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
function placeDeskLamps(fixtures: Fixtures, frame: FixtureFrame): void {
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

// The warm pools over the tables of every lit room, and the lobby's red after an index drop.
function syncWarm(pool: Pool, frame: FixtureFrame): boolean {
  const { sim, row } = frame
  const glow = row.glow * sim.props.lampGlow

  if (
    !beginPool(pool, `${sim.floor}|${[...sim.props.lit].join()}|${glow}|${frame.dropPct ?? ''}`)
  ) {
    return false
  }

  for (const [x, z, radius] of TABLE_POOLS[sim.floor]) {
    const room = roomAt(sim.floor, { x, y: z })

    if (room !== undefined && sim.props.lit.has(room.id)) {
      glowAt(pool, { x, z, radius, rgb: WARM_RGB, alpha: glow })
    }
  }

  if (sim.floor === 'office' && frame.dropPct !== undefined) {
    const [x, z, radius] = DROP_POOL

    glowAt(pool, { x, z, radius, rgb: ALERT_RGB, alpha: dropAlphaOf(frame.dropPct) })
  }

  endPool(pool)

  return true
}

// An own agent's desk casts a cool glow while the agent is not paused.
function syncCool(pool: Pool, frame: FixtureFrame): boolean {
  const desks =
    frame.sim.floor === 'team' ? frame.sim.team.desks.filter((desk) => desk.isGlowing) : []

  if (!beginPool(pool, desks.map((desk) => desk.slot).join())) {
    return false
  }

  for (const desk of desks) {
    const slot = DESK_SLOTS[desk.slot]

    if (slot !== undefined) {
      glowAt(pool, {
        x: slot.x + DESK_GLOW.dx,
        z: slot.y + DESK_GLOW.dy,
        radius: DESK_GLOW.radius,
        rgb: COOL_RGB,
        alpha: DESK_GLOW.alpha,
      })
    }
  }

  endPool(pool)

  return true
}

// Additive light: the instance colour is the light's colour times its strength.
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

// Every person's contact shadow and status dot, and the ring under the selected one.
function syncPeople(fixtures: Fixtures, frame: FixtureFrame): boolean {
  const key = `${frame.standing.map(({ actor, at, top }) => `${actor.id}${at.x}${at.y}${top}${actor.status ?? ''}`).join()}|${frame.selected ?? ''}|${frame.scale}`

  if (!beginPool(fixtures.shadows, key)) {
    return false
  }

  beginPool(fixtures.dots, key)
  beginPool(fixtures.ring, key)

  const dotPx = Math.min(DOT_PX.max, Math.max(DOT_PX.min, DOT_PX.screen / frame.scale))

  for (const { actor, at, top } of frame.standing) {
    placeInstance(fixtures.shadows, {
      x: at.x,
      y: POOL_Y / 2,
      z: at.y,
      size: SHADOW_SIZE,
      tilt: FLAT_TILT,
    })

    if (actor.status !== undefined) {
      placeInstance(fixtures.dots, {
        x: at.x,
        y: top + DOT_RISE_PX + dotPx,
        z: at.y,
        size: [dotPx, dotPx, 1],
        tilt: -ELEVATION,
        color: DOT_TONES[actor.status],
      })
    }

    if (actor.id === frame.selected) {
      placeInstance(fixtures.ring, {
        x: at.x,
        y: POOL_Y,
        z: at.y + RING.d / 2,
        size: [RING.w, RING.h, 1],
      })
    }
  }

  endPool(fixtures.shadows)
  endPool(fixtures.dots)
  endPool(fixtures.ring)

  return true
}
