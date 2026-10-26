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
import { LIFT_LEAF_SLIDE } from '@/web/scene/sprites/lift-look'
import { PROP_TONES } from '@/web/scene/sprites/palette'
import { GROUND_FLOOR, TEAM_FLOOR } from '@/web/scene/world/floors'
import { type PropDef, propsOn } from '@/web/scene/world/props'

// The leaves stand this far proud of the cabin face; the panel and its lamps over the frame.
const LEAF_PROUD = 0.3
const LEAF_D = 0.4
const PANEL = Object.freeze({ inset: 3, rise: 1.2, h: 3, d: 0.6 })
const LIFTS: Readonly<Record<FloorId, PropDef | undefined>> = Object.freeze({
  office: propsOn(GROUND_FLOOR).find((prop) => prop.kind === 'lift-door'),
  team: propsOn(TEAM_FLOOR).find((prop) => prop.kind === 'lift-door'),
})

/** The lift on the floor shown: its two leaves and the panel over them; the panel's indicator is
 *  a painted face (`screen-faces`). Placed again only when the car or its doors change. */
export interface Lift3d {
  readonly leaves: Pool
  shown: { floor: FloorId | undefined; at: FloorId; doors: number }
}

export function createLift3d(shapes: Shapes, materials: Materials, root: Group): Lift3d {
  const leaves = createPool(shapes.box, materials.litI, { cap: 3 })

  root.add(leaves.mesh)

  return { leaves, shown: { floor: undefined, at: GROUND_FLOOR, doors: -1 } }
}

/** True when the lift on `floor` changed its picture. */
export function syncLift3d(lift: Lift3d, at: { floor: FloorId; view: LiftView }): boolean {
  const { view, floor } = at
  const doors = view.floor === floor ? view.doors : 0
  const { shown } = lift

  if (shown.floor === floor && shown.at === view.floor && shown.doors === doors) {
    return false
  }

  lift.shown = { floor, at: view.floor, doors }
  lift.leaves.count = 0

  const prop = LIFTS[floor]

  if (prop !== undefined) {
    placeLift(lift, { prop, doors })
  }

  endPool(lift.leaves)

  return true
}

/** The panel over the lift doors: its centre and size, where the indicator face lies. */
export function liftPanelOf(prop: PropDef): {
  readonly at: readonly [x: number, y: number, z: number]
  readonly size: readonly [w: number, h: number]
} {
  const [x, z, w, d, base, tall] = wallSpotsOf(prop).face

  return {
    at: [x + w / 2, base + tall + PANEL.rise + PANEL.h / 2, z + d + LEAF_PROUD + PANEL.d / 2],
    size: [w - PANEL.inset * 2, PANEL.h],
  }
}

function placeLift(lift: Lift3d, spec: { readonly prop: PropDef; readonly doors: number }): void {
  const [x, z, w, d, base, tall] = wallSpotsOf(spec.prop).face
  const leafW = (w / 2) * (1 - spec.doors * LIFT_LEAF_SLIDE)
  const front = z + d + LEAF_PROUD
  const y = base + tall / 2
  const panel = liftPanelOf(spec.prop)

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
    x: panel.at[0],
    y: panel.at[1],
    z: panel.at[2],
    size: [panel.size[0], panel.size[1], PANEL.d],
    color: PROP_TONES.liftPanel,
  })
}

export function disposeLift3d(lift: Lift3d): void {
  lift.leaves.mesh.dispose()
}
