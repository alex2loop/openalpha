import { AdditiveBlending, type Group, MeshBasicMaterial } from 'three'

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
import {
  createLampGlow,
  FLAT_TILT,
  glowAt,
  POOL_Y,
  syncLamps,
} from '@/web/scene/render3d/lamp-glow'
import { createLaptop, disposeLaptop, type Laptop, syncLaptop } from '@/web/scene/render3d/laptop'
import { createMarks, disposeMarks, type Marks, syncMarks } from '@/web/scene/render3d/marks'
import {
  createMonitorFaces,
  disposeMonitorFaces,
  type MonitorFaces,
  syncMonitorFaces,
} from '@/web/scene/render3d/monitor-faces'
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
  readonly monitors: MonitorFaces
  readonly marks: Marks
  readonly laptop: Laptop
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
  readonly now: number
  readonly isReduced: boolean
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
const DESK_GLOW = Object.freeze({ dx: 20, dy: -6, radius: 28, alpha: 0.32 })
const DOT_RISE_PX = 6
const MONITOR_BACK = '#2A2F3F'
// The mockup's 3D status dots: green free, amber waiting, red after an error.
const DOT_TONES = Object.freeze({ free: '#32D74B', waiting: '#F2B33D', failed: '#FF6259' })
const DOT_PX = Object.freeze({ max: 3.4, min: 1.5, screen: 5 })
const RING = Object.freeze({ w: 16, d: 10, h: 0.3 })

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
  const lampGlow = createLampGlow(shapes.glow)
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
    monitors: createMonitorFaces(root),
    marks: createMarks(shapes, glow, root),
    laptop: createLaptop(root, materials.lit),
    owned: [glow, lampGlow, shadow, dot, ink],
  }

  root.add(...poolsOf(fixtures).map((pool) => pool.mesh))

  return fixtures
}

/** Rewrites the fixtures whose picture changed; true when one did. */
export function syncFixtures(fixtures: Fixtures, frame: FixtureFrame): boolean {
  const changes = [
    syncScreens(fixtures, frame),
    syncBacks(fixtures.backs, frame),
    syncLamps(fixtures, frame),
    syncWarm(fixtures.warm, frame),
    syncCool(fixtures.cool, frame),
    syncPeople(fixtures, frame),
    syncLaptop(fixtures.laptop, { floor: frame.sim.floor, screens: frame.sim.deskScreens }),
    syncMarks(fixtures.marks, {
      marks: frame.sim.marks,
      standing: frame.standing,
      now: frame.now,
      isReduced: frame.isReduced,
    }),
  ]

  return changes.some(Boolean)
}

export function disposeFixtures(fixtures: Fixtures): void {
  for (const pool of poolsOf(fixtures)) {
    pool.mesh.dispose()
  }

  disposeMonitorFaces(fixtures.monitors)
  disposeMarks(fixtures.marks)
  disposeLaptop(fixtures.laptop)

  for (const one of fixtures.owned) {
    one.dispose()
  }
}

function poolsOf(fixtures: Fixtures): Pool[] {
  const { screens, backs, shades, warm, cool, lampPools, halos, shadows, dots, ring } = fixtures

  return [screens, backs, shades, warm, cool, lampPools, halos, shadows, dots, ring]
}

// The screens lit by someone at work at their seat glow and show their room's run; the rest stand
// by, or sleep while the office is quiet.
function syncScreens(fixtures: Fixtures, frame: FixtureFrame): boolean {
  const pool = fixtures.screens
  const lit = frame.props.screens.map((screen) =>
    frame.standing.some(
      ({ actor, at }) =>
        actor.working && Math.hypot(at.x - screen.seat.x, at.y - screen.seat.y) <= SCREEN_REACH_PX
    )
  )

  const idle = frame.sim.life.isQuiet ? PROP_TONES.screenOff : PROP_TONES.screenStandby

  const isFaced = syncMonitorFaces(fixtures.monitors, {
    floor: frame.sim.floor,
    props: frame.props,
    lit,
    deskScreens: frame.sim.deskScreens,
    now: frame.now,
    isReduced: frame.isReduced,
  })

  if (!beginPool(pool, `${frame.sim.floor}|${idle}|${lit.join()}`)) {
    return isFaced
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

// The monitors' backs lean with their faces, the StandBy phones' upper halves on their folds; they
// change only with the floor.
function syncBacks(pool: Pool, frame: FixtureFrame): boolean {
  if (!beginPool(pool, frame.sim.floor)) {
    return false
  }

  for (const { back, tilt } of frame.props.screens) {
    const [x, y, z] = back.at

    placeInstance(pool, { x, y, z, size: back.size, tilt, color: MONITOR_BACK })
  }

  for (const lean of frame.props.leans) {
    const [x, y, z] = lean.at

    placeInstance(pool, { x, y, z, size: lean.size, tilt: lean.tilt, color: lean.color })
  }

  endPool(pool)

  return true
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
