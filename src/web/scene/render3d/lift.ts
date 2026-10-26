import type { Group } from 'three'

import type { Materials } from '@/web/scene/render3d/lights'
import type { FloorId, LiftView } from '@/web/scene/types'
import {
  createPool,
  endPool,
  type Pool,
  placeInstance,
  type Shapes,
} from '@/web/scene/render3d/instancing'
import { wallSpotsOf } from '@/web/scene/render3d/wall-spots'
import { LIFT_LAMP_FLOORS, LIFT_LEAF_SLIDE } from '@/web/scene/sprites/lift-look'
import { PROP_TONES } from '@/web/scene/sprites/palette'
import { GROUND_FLOOR, TEAM_FLOOR } from '@/web/scene/world/floors'
import { type PropDef, propsOn } from '@/web/scene/world/props'

// The leaves stand this far proud of the cabin face; the panel and its lamps over the frame.
const LEAF_PROUD = 0.3
const LEAF_D = 0.4
const PANEL = Object.freeze({ inset: 3, rise: 1.2, h: 3, d: 0.6 })
const LAMP = Object.freeze({ w: 2, h: 1.6, inset: 2 })
const CALL_W = 1.6
const LIFTS: Readonly<Record<FloorId, PropDef | undefined>> = Object.freeze({
  office: propsOn(GROUND_FLOOR).find((prop) => prop.kind === 'lift-door'),
  team: propsOn(TEAM_FLOOR).find((prop) => prop.kind === 'lift-door'),
})

/** The lift on the floor shown: its two leaves and the panel over them (lit), the floor lamps
 *  and the call lamp (unlit). Placed again only when the car, its doors or a call change. */
export interface Lift3d {
  readonly leaves: Pool
  readonly lamps: Pool
  shown: { floor: FloorId | undefined; at: FloorId; doors: number; calls: number }
}

export function createLift3d(shapes: Shapes, materials: Materials, root: Group): Lift3d {
  const leaves = createPool(shapes.box, materials.litI, { cap: 3 })
  const lamps = createPool(shapes.box, materials.unlitI, { cap: LIFT_LAMP_FLOORS.length + 1 })

  root.add(leaves.mesh, lamps.mesh)

  return { leaves, lamps, shown: { floor: undefined, at: GROUND_FLOOR, doors: -1, calls: -1 } }
}

/** True when the lift on `floor` changed its picture. */
export function syncLift3d(lift: Lift3d, at: { floor: FloorId; view: LiftView }): boolean {
  const { view, floor } = at
  const doors = view.floor === floor ? view.doors : 0
  const calls = view.called.includes(floor) ? 1 : 0
  const { shown } = lift

  if (
    shown.floor === floor &&
    shown.at === view.floor &&
    shown.doors === doors &&
    shown.calls === calls
  ) {
    return false
  }

  lift.shown = { floor, at: view.floor, doors, calls }
  lift.leaves.count = 0
  lift.lamps.count = 0

  const prop = LIFTS[floor]

  if (prop !== undefined) {
    placeLift(lift, { prop, doors, isCalled: calls > 0, at: view.floor })
  }

  endPool(lift.leaves)
  endPool(lift.lamps)

  return true
}

function placeLift(
  lift: Lift3d,
  spec: {
    readonly prop: PropDef
    readonly doors: number
    readonly isCalled: boolean
    readonly at: FloorId
  }
): void {
  const [x, z, w, d, base, tall] = wallSpotsOf(spec.prop).face
  const leafW = (w / 2) * (1 - spec.doors * LIFT_LEAF_SLIDE)
  const front = z + d + LEAF_PROUD
  const y = base + tall / 2
  const top = base + tall + PANEL.rise + PANEL.h / 2

  for (const left of [x, x + w - leafW]) {
    placeInstance(lift.leaves, {
      x: left + leafW / 2,
      y,
      z: front,
      size: [leafW, tall, LEAF_D],
      color: PROP_TONES.liftLeaf,
    })
  }

  placeInstance(lift.leaves, {
    x: x + w / 2,
    y: top,
    z: front,
    size: [w - PANEL.inset * 2, PANEL.h, PANEL.d],
    color: PROP_TONES.liftPanel,
  })

  LIFT_LAMP_FLOORS.forEach((floor, i) => {
    const lampX = x + PANEL.inset + LAMP.inset + i * (w - 2 * (PANEL.inset + LAMP.inset))

    placeInstance(lift.lamps, {
      x: lampX,
      y: top,
      z: front + PANEL.d,
      size: [LAMP.w, LAMP.h, LEAF_D],
      color: PROP_TONES.liftLamp[floor === spec.at ? 1 : 0],
    })
  })

  if (spec.isCalled) {
    placeInstance(lift.lamps, {
      x: x + w / 2,
      y: top,
      z: front + PANEL.d,
      size: [CALL_W, LAMP.h, LEAF_D],
      color: PROP_TONES.callLamp,
    })
  }
}

export function disposeLift3d(lift: Lift3d): void {
  lift.leaves.mesh.dispose()
  lift.lamps.mesh.dispose()
}
