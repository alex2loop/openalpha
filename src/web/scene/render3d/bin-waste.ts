import type { Group } from 'three'

import type { Materials } from '@/web/scene/render3d/lights'
import type { DeskView, FloorId, SimView } from '@/web/scene/types'
import type { PropDef } from '@/web/scene/world/props'
import { BIN } from '@/web/scene/render3d/desk-dressing'
import {
  beginPool,
  createPool,
  endPool,
  type Pool,
  placeInstance,
  type Shapes,
} from '@/web/scene/render3d/instancing'
import { BIN_SLOTS, type BinFill, binFill } from '@/web/scene/sim/bins'
import { PALETTE } from '@/web/scene/sprites/palette'
import { DESK_SLOTS, TEAM_FLOOR } from '@/web/scene/world/floors'
import { propsOn } from '@/web/scene/world/props'

// The crumpled sheets heaped over a bin's rim, first to last: offsets from the rim's middle
// across and along, and how high each sits over the rim.
const BALLS = [
  [-1, -0.6, 0.9],
  [1.1, 0.5, 0.9],
  [0, 0, 2.6],
] as const
const BALL_PX = 2.6
const RIM_PX = 0.9
const MAX_BALLS = (DESK_SLOTS.length + propsOn('office').length) * BIN_SLOTS
const KEY_SEPARATOR = '|'

/** The day's crumpled sheets over the desk bins of the floor shown, one instanced mesh. */
export interface BinWaste3d {
  /** Heaps each desk bin of the floor shown as full as `binFill` says; true when it changed. */
  sync(sim: SimView): boolean
  dispose(): void
}

export function createBinWaste(shapes: Shapes, materials: Materials, root: Group): BinWaste3d {
  const pool = createPool(shapes.box, materials.litI, { cap: MAX_BALLS })

  root.add(pool.mesh)

  return {
    sync: (sim) => syncBinWaste(pool, sim),
    dispose: () => pool.mesh.dispose(),
  }
}

function syncBinWaste(pool: Pool, sim: SimView): boolean {
  const fill = binFill.value
  const bins = binsOf(sim.floor, { fill, desks: sim.team.desks })
  const key = [sim.floor, ...bins.map((bin) => `${bin.desk.id}:${bin.count}`)].join(KEY_SEPARATOR)

  if (!beginPool(pool, key)) {
    return false
  }

  for (const { desk, count } of bins) {
    placeBalls(pool, { desk, count })
  }

  endPool(pool)

  return true
}

interface Bin {
  readonly desk: PropDef
  readonly count: number
}

// The library's desks by their prop, the team floor's by the agent working at each.
function binsOf(
  floor: FloorId,
  at: { readonly fill: BinFill; readonly desks: readonly DeskView[] }
): Bin[] {
  const desks = propsOn(floor).filter((prop) => prop.kind === 'desk')

  if (floor !== TEAM_FLOOR) {
    return desks.flatMap((desk) => {
      const count = at.fill.byDesk.get(desk.id) ?? 0

      return count > 0 ? [{ desk, count }] : []
    })
  }

  return at.desks.flatMap((view) => {
    const slot = DESK_SLOTS[view.slot]
    const desk = desks.find((prop) => prop.draw.x === slot?.x && prop.draw.y === slot?.y)
    const count = view.agentId === undefined ? 0 : (at.fill.byAgent.get(view.agentId) ?? 0)

    return desk !== undefined && count > 0 ? [{ desk, count }] : []
  })
}

// Over the bin beside the desk's right end, as the desk's dressing stands it.
function placeBalls(pool: Pool, bin: Bin): void {
  const { x, y, w } = bin.desk.rect
  const middle = { x: x + w + BIN.dx + BIN.w / 2, z: y + BIN.dz + BIN.w / 2 }

  for (const [dx, dz, rise] of BALLS.slice(0, bin.count)) {
    placeInstance(pool, {
      x: middle.x + dx,
      y: BIN.h + RIM_PX + rise - BALL_PX / 2,
      z: middle.z + dz,
      size: [BALL_PX, BALL_PX, BALL_PX],
      color: PALETTE.paper,
    })
  }
}
