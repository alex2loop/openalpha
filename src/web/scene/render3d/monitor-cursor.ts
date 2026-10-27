import { Color, Matrix4, type Mesh, Quaternion, Vector3 } from 'three'

import type { FloorId } from '@/web/scene/types'
import { ambientMsOf } from '@/web/scene/budgets'
import { beginPool, endPool, type Pool } from '@/web/scene/render3d/instancing'
import { CURSOR_TONE, type CursorRect, SCREEN } from '@/web/scene/render3d/monitor-screen'
import { toUnits } from '@/web/scene/render3d/space'

// The mockup's cursor shows for this long, then hides for as long.
const BLINK_MS = 530
// The block's thickness and how far it stands off the face, in world px.
const BLOCK_PX = 0.2
const LIFT_PX = 0.2

/** A monitor face a cursor stands on. */
interface CursorHost {
  readonly mesh: Mesh
  /** Where the cursor goes on the face; absent when the face has none. */
  readonly cursor: CursorRect | undefined
  readonly isFlat: boolean
}

const world = new Matrix4()
const local = new Matrix4()
const placed = new Vector3()
const sized = new Vector3()
const upright = new Quaternion()
const tone = new Color(CURSOR_TONE)

/** Whether the cursor shows at `nowMs`: it blinks on the ambient clock, and stays solid when
 *  motion is reduced. */
export function isCursorShown(nowMs: number, isReduced: boolean): boolean {
  return isReduced || Math.floor(ambientMsOf(nowMs) / BLINK_MS) % 2 === 0
}

/** Stands one block on each lit face that has a cursor, all in one instanced mesh, so a blink
 *  rewrites the matrices and never repaints a face; true when they changed. */
export function syncCursors(
  pool: Pool,
  at: {
    readonly floor: FloorId
    readonly faces: readonly CursorHost[]
    readonly isShown: boolean
  }
): boolean {
  const spots = at.faces.map((host) => (at.isShown ? spotOf(host) : ''))
  const key = spots.every((spot) => spot === '') ? '' : `${at.floor}|${spots.join('|')}`

  if (!beginPool(pool, key)) {
    return false
  }

  at.faces.forEach((host, i) => {
    if (spots[i] !== '') {
      place(pool, host)
    }
  })
  endPool(pool)

  return true
}

// Where a face's cursor stands, as text; empty when the face is dark or has none.
function spotOf({ mesh, cursor, isFlat }: CursorHost): string {
  return !mesh.visible || cursor === undefined
    ? ''
    : `${isFlat ? 'f' : 's'}${cursor.x},${cursor.y},${cursor.w},${cursor.h}`
}

// The block in the face's own space, where the plane is one unit square, then moved with the face.
function place(pool: Pool, { mesh, cursor }: CursorHost): void {
  if (cursor === undefined || pool.count >= pool.mesh.instanceMatrix.count) {
    return
  }

  mesh.updateMatrix()
  placed.set(
    (cursor.x + cursor.w / 2) / SCREEN.w - 0.5,
    0.5 - (cursor.y + cursor.h / 2) / SCREEN.h,
    toUnits(LIFT_PX)
  )
  sized.set(cursor.w / SCREEN.w, cursor.h / SCREEN.h, toUnits(BLOCK_PX))
  local.compose(placed, upright, sized)
  pool.mesh.setMatrixAt(pool.count, world.multiplyMatrices(mesh.matrix, local))
  pool.mesh.setColorAt(pool.count, tone)
  pool.count++
}
