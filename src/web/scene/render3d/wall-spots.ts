import type { Spot } from '@/web/scene/render3d/boxes'
import type { PropDef } from '@/web/scene/world/props'
import { HEIGHT_K } from '@/web/scene/view'
import { roomById, WALL_BAND_PX } from '@/web/scene/world/rooms'

const WALL_FACE_PROUD = 0.8
const FACE_PLATE_PX = 0.3

/** A wall piece's frame and the face plate in front of it. One on a wall's band hangs on the north
 *  wall at the height that lines it up with 2D; one below the band stands on the floor facing the
 *  camera, its foot at the drawn box's bottom, so its face covers what 2D draws. */
export function wallSpotsOf(prop: PropDef): {
  readonly frame: Spot
  readonly face: Spot
  /** The z of the wall it hangs on; absent for a piece standing on the floor. */
  readonly wallZ?: number
} {
  const room = roomById(prop.room)
  const wallZ = (room?.rect.y ?? 0) + WALL_BAND_PX
  const { x, y, w, h } = prop.rect
  const isHung = y + h <= wallZ + 1
  const z = isHung ? wallZ : y + h
  const base = isHung ? (wallZ - (y + h)) / HEIGHT_K : 0
  const tall = h / HEIGHT_K

  return {
    frame: [x, z - (isHung ? 0 : WALL_FACE_PROUD), w, WALL_FACE_PROUD, base, tall],
    face: [x + 1, z + (isHung ? WALL_FACE_PROUD : 0), w - 2, FACE_PLATE_PX, base + 1, tall - 2],
    ...(isHung ? { wallZ } : {}),
  }
}
