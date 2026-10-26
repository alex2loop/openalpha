import type { Group } from 'three'

import type { Materials } from '@/web/scene/render3d/lights'
import type { Build, Recipe } from '@/web/scene/render3d/props'
import type { Point, SimView } from '@/web/scene/types'
import { box } from '@/web/scene/render3d/boxes'
import {
  createPool,
  endPool,
  type Pool,
  placeInstance,
  type Shapes,
} from '@/web/scene/render3d/instancing'
import { DARKWOOD, METAL, OUTLINE, PALETTE, PROP_TONES } from '@/web/scene/sprites/palette'
import { GROUND_FLOOR } from '@/web/scene/world/floors'
import { wetSignRectOf } from '@/web/scene/world/props'

const SIGN_PX = Object.freeze({ w: 7, d: 4, h: 12 })
const BUCKET_PX = Object.freeze({ w: 5, h: 5 })
const LAMP_PX = 0.6

/** The badge gates' pedestals and the guard's podium, and the bins. */
export const CREW_RECIPES: Readonly<Record<'bin' | 'gate-post' | 'podium', Recipe>> = Object.freeze(
  {
    bin: ({ prop, out }) => {
      const { x, y, w, h } = prop.rect

      out.push(box([x, y, w, h, 0, prop.height], PROP_TONES.bin, true))
      out.push(box([x, y, w, h, prop.height, LAMP_PX], METAL[0]))
    },
    'gate-post': ({ prop, out }) => {
      const { x, y, w, h } = prop.rect

      out.push(box([x, y, w, h, 0, prop.height], METAL[1], true))
      out.push(box([x + 2, y, 2, h, prop.height, LAMP_PX], PROP_TONES.callLamp))
    },
    podium: ({ prop, out }) => {
      const { x, y, w, h } = prop.rect

      out.push(box([x, y, w, h, 0, prop.height], DARKWOOD[1], true))
      out.push(box([x + 1, y + 1, w - 2, h - 2, prop.height, LAMP_PX], PROP_TONES.screenStandby))
    },
  }
)

/** What the front desk carries besides its top and legs: the monitor, the bell, the plaque on
 *  its front. */
export function frontDeskThings({ prop, out }: Build): void {
  const { x, y, h } = prop.rect
  const top = prop.height

  out.push(box([x + 1, y + 1, 6, 1.5, top + 2, 5], PROP_TONES.screenOff))
  out.push(box([x + 3, y + 1.5, 2, 1, top, 2], OUTLINE))
  out.push(box([x + 12, y + 4, 3, 3, top, 1.5], PROP_TONES.bell, true))
  out.push(box([x + 5, y + h, 8, 0.4, top - 6, 3], PALETTE.paper))
}

/** The cleaner's wet-floor sign and its bucket: one instanced mesh, placed again only when the
 *  sign hops. */
export interface WetSign3d {
  readonly pool: Pool
  at: Point | undefined
}

export function createWetSign(shapes: Shapes, materials: Materials, root: Group): WetSign3d {
  const pool = createPool(shapes.box, materials.litI, { cap: 2 })

  root.add(pool.mesh)

  return { pool, at: undefined }
}

/** Places the sign and the bucket where the snapshot has them on the floor shown; true when they
 *  moved, came or went. */
export function syncWetSign(sign: WetSign3d, sim: SimView): boolean {
  const at = sim.floor === GROUND_FLOOR ? sim.life.wetSign : undefined

  if (at === sign.at) {
    return false
  }

  sign.at = at
  sign.pool.count = 0

  if (at !== undefined) {
    const foot = wetSignRectOf(at)

    placeInstance(sign.pool, {
      x: foot.x + SIGN_PX.w / 2,
      y: SIGN_PX.h / 2,
      z: at.y - SIGN_PX.d / 2,
      size: [SIGN_PX.w, SIGN_PX.h, SIGN_PX.d],
      color: PROP_TONES.wetSign,
    })
    placeInstance(sign.pool, {
      x: foot.x + foot.w - BUCKET_PX.w / 2,
      y: BUCKET_PX.h / 2,
      z: at.y - BUCKET_PX.w / 2,
      size: [BUCKET_PX.w, BUCKET_PX.h, BUCKET_PX.w],
      color: PROP_TONES.bucket,
    })
  }

  endPool(sign.pool)

  return true
}

export function disposeWetSign(sign: WetSign3d): void {
  sign.pool.mesh.dispose()
}
