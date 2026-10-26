import type { OrthographicCamera } from 'three'
import { Vector3 } from 'three'

import type { Point, ScreenPoint, Size } from '@/web/scene/types'
import { toUnits, UNIT_PX } from '@/web/scene/render3d/space'
import {
  clampPan,
  ELEVATION,
  MAX_ZOOM_3D_PX,
  reportProjection,
  STREET_RECT,
  view,
  ZOOM_STEP,
} from '@/web/scene/view'
import { fitFloorScale, fitRoomScale, NARROW_MIN_SCALE } from '@/web/scene/world/framing'
import { roomById } from '@/web/scene/world/rooms'
import { breakpoint } from '@/web/state/breakpoints'

/** Where the floor sits in the pane: CSS px per world px and the CSS px of world (0, 0). */
export interface Placement {
  readonly scale: number
  readonly originX: number
  readonly originY: number
}

/** The camera as eased toward the view: its scale and the world point at the pane's centre. */
interface Shot {
  readonly scale: number
  readonly center: Point
}

/** The fixed camera and where its last frame put the floor. */
export interface CameraRig {
  readonly camera: OrthographicCamera
  shot: Shot | undefined
  placement: Placement
}

const CAMERA_DISTANCE = 80
// The camera eases to a new framing over about this long; a gap under `SETTLED` has arrived.
const CAMERA_EASE_MS = 180
const SETTLED = 0.002
const VIEW_DIR = new Vector3(0, Math.sin(ELEVATION), Math.cos(ELEVATION))
const target = new Vector3()
// The mockup's farthest 3D zoom-out, as a share of the fitted floor's scale.
const MIN_ZOOM_SHARE = 0.25

/** Frames the view's floor, room or zoom like 2D does, eased unless motion is reduced; the
 *  projection the overlays read follows every eased step. */
export function placeCamera(
  rig: CameraRig,
  spec: { readonly pane: Size; readonly dtMs: number; readonly isReduced: boolean }
): { readonly isMoved: boolean; readonly isGliding: boolean } {
  const { pane } = spec
  const base = fitFloor(pane)
  const wanted = wantedShot(pane, base)
  const held = rig.shot
  const k = spec.isReduced || held === undefined ? 1 : 1 - Math.exp(-spec.dtMs / CAMERA_EASE_MS)
  const next = held === undefined ? wanted : easeShot(held, wanted, k)
  const isGliding = next !== wanted
  const originX = pane.w / 2 - next.center.x * next.scale
  const originY = pane.h / 2 - next.center.y * next.scale
  const isMoved =
    rig.placement.scale !== next.scale ||
    rig.placement.originX !== originX ||
    rig.placement.originY !== originY

  rig.shot = next
  rig.placement = { scale: next.scale, originX, originY }
  reportProjection({
    pane,
    scale: next.scale,
    baseScale: base,
    originX,
    originY,
    maxScale: maxScaleOf(base),
    minScale: minScaleOf(base, pane),
  })
  aim(rig.camera, next, pane)

  return { isMoved, isGliding }
}

export function toScreen(placement: Placement, p: Point): ScreenPoint {
  return {
    x: placement.originX + p.x * placement.scale,
    y: placement.originY + p.y * placement.scale,
  }
}

/** The floor point under `s`: the pointer's ray meets the floor plane where 2D would put it. */
export function toWorld(placement: Placement, s: ScreenPoint): Point {
  return {
    x: (s.x - placement.originX) / placement.scale,
    y: (s.y - placement.originY) / placement.scale,
  }
}

// The zoom from the floor's fit up to the 3D cap; a room fits with a tenth to spare.
function wantedShot(pane: Size, base: number): Shot {
  const held = view.value
  const room = held.room === undefined ? undefined : roomById(held.room)
  const want =
    room === undefined ? base * ZOOM_STEP ** held.zoomSteps : fitRoomScale(room.rect, pane)
  const scale = Math.max(minScaleOf(base, pane), Math.min(maxScaleOf(base), want))

  return { scale, center: clampPan(held.center, scale, pane) }
}

function easeShot(held: Shot, wanted: Shot, k: number): Shot {
  const scale = held.scale + (wanted.scale - held.scale) * k
  const x = held.center.x + (wanted.center.x - held.center.x) * k
  const y = held.center.y + (wanted.center.y - held.center.y) * k
  const isThere =
    Math.abs(scale - wanted.scale) / wanted.scale < SETTLED &&
    Math.abs(x - wanted.center.x) * wanted.scale < 1 &&
    Math.abs(y - wanted.center.y) * wanted.scale < 1

  return isThere ? wanted : { scale, center: { x, y } }
}

// The camera looks north and down at the centre's floor point; the frustum's height is
// foreshortened so a step north on the floor moves as far up the screen as in 2D.
function aim(camera: OrthographicCamera, shot: Shot, pane: Size): void {
  const halfW = pane.w / (2 * UNIT_PX * shot.scale)
  const halfH = (pane.h / (2 * UNIT_PX * shot.scale)) * Math.sin(ELEVATION)

  target.set(toUnits(shot.center.x), 0, toUnits(shot.center.y))
  camera.position.copy(target).addScaledVector(VIEW_DIR, CAMERA_DISTANCE)
  camera.lookAt(target)
  camera.left = -halfW
  camera.right = halfW
  camera.top = halfH
  camera.bottom = -halfH
  camera.updateProjectionMatrix()
}

// The 3D view's closest zoom in CSS px per world px, never under the floor's own fit.
function maxScaleOf(base: number): number {
  return Math.max(base, MAX_ZOOM_3D_PX / devicePixelRatio)
}

// As far out as shows the whole street's height, Bitexco's crown and the side parks, but never
// under `MIN_ZOOM_SHARE` of the fitted floor.
function minScaleOf(base: number, pane: Size): number {
  return Math.min(base, Math.max(base * MIN_ZOOM_SHARE, pane.h / STREET_RECT.h))
}

function fitFloor(pane: Size): number {
  const raw = fitFloorScale(pane)

  return breakpoint.value === 'wide' ? raw : Math.max(NARROW_MIN_SCALE, raw)
}
