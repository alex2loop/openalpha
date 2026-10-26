import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Scene,
  SRGBColorSpace,
} from 'three'

import type { StreetFrame } from '@/web/scene/street-types'
import type { Rect } from '@/web/scene/types'
import { SMALL_MOTION_RENDERS_PER_S } from '@/web/scene/budgets'
import { toUnits } from '@/web/scene/render3d/space'
import { STREET_RECT } from '@/web/scene/view'
import { MS_PER_SECOND } from '@/web/text/time-units'

// Both planes lie just under the floor plane, the moving one over the static one, so the
// building's own floor always wins.
const GROUND_DROP = 0.02
const MOVING_DROP = 0.01
const MOVING_UPLOAD_GAP_MS = MS_PER_SECOND / SMALL_MOTION_RENDERS_PER_S
const UNSEEN = -1

/** One street canvas on a flat plane, the texture it last uploaded and the canvas size that
 *  texture was made at. */
interface StreetPlane {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>
  texture: CanvasTexture | undefined
  version: number
  width: number
  height: number
}

/** The street in 3D: the static canvas on the ground, the moving one over its rect. Nothing else
 *  in 3D owns street state. */
export interface StreetPlanes {
  readonly ground: StreetPlane
  readonly moving: StreetPlane
  movingAt: number
}

export function createStreetPlanes(scene: Scene): StreetPlanes {
  const ground = createPlane({ isTransparent: false })
  const moving = createPlane({ isTransparent: true })

  placePlane(ground.mesh, { rect: STREET_RECT, drop: GROUND_DROP })
  scene.add(ground.mesh, moving.mesh)

  return { ground, moving, movingAt: Number.NEGATIVE_INFINITY }
}

/** Uploads a canvas only when its version moved, the moving one at most
 *  `SMALL_MOTION_RENDERS_PER_S` times a second; `isPending` while a moving upload waits. */
export function syncStreetPlanes(
  planes: StreetPlanes,
  at: { readonly frame: StreetFrame; readonly now: number }
): { readonly isChanged: boolean; readonly isPending: boolean } {
  const { frame, now } = at
  const isGroundNew = syncPlane(planes.ground, frame.staticCanvas, frame.staticVersion)
  const isMovingDue = frame.movingVersion !== planes.moving.version
  const isMovingHeld = isMovingDue && now - planes.movingAt < MOVING_UPLOAD_GAP_MS

  if (!isMovingDue || isMovingHeld) {
    return { isChanged: isGroundNew, isPending: isMovingHeld }
  }

  syncPlane(planes.moving, frame.movingCanvas, frame.movingVersion)
  placePlane(planes.moving.mesh, { rect: frame.movingRect, drop: MOVING_DROP })
  planes.movingAt = now

  return { isChanged: true, isPending: false }
}

export function disposeStreetPlanes(planes: StreetPlanes): void {
  for (const plane of [planes.ground, planes.moving]) {
    plane.mesh.removeFromParent()
    plane.mesh.geometry.dispose()
    plane.mesh.material.dispose()
    plane.texture?.dispose()
    plane.texture = undefined
  }
}

function createPlane(spec: { readonly isTransparent: boolean }): StreetPlane {
  // The street is the world outside the glass: no fog over it, as the mockup paints it apart.
  const material = new MeshBasicMaterial({
    fog: false,
    toneMapped: false,
    transparent: spec.isTransparent,
    depthWrite: !spec.isTransparent,
  })
  const mesh = new Mesh(new PlaneGeometry(1, 1), material)

  mesh.rotation.x = -Math.PI / 2
  mesh.visible = false

  return { mesh, texture: undefined, version: UNSEEN, width: 0, height: 0 }
}

function placePlane(mesh: Mesh, at: { readonly rect: Rect; readonly drop: number }): void {
  const { rect } = at

  mesh.scale.set(
    Math.max(toUnits(rect.w), Number.EPSILON),
    Math.max(toUnits(rect.h), Number.EPSILON),
    1
  )
  mesh.position.set(toUnits(rect.x + rect.w / 2), -at.drop, toUnits(rect.y + rect.h / 2))
}

// A canvas of a new size needs a new texture: an uploaded one keeps the size it was made at.
function syncPlane(plane: StreetPlane, canvas: HTMLCanvasElement, version: number): boolean {
  if (plane.version === version) {
    return false
  }

  plane.version = version
  plane.mesh.visible = canvas.width > 0

  if (canvas.width === 0) {
    return true
  }

  const held = plane.texture

  if (held !== undefined && plane.width === canvas.width && plane.height === canvas.height) {
    held.needsUpdate = true
    return true
  }

  held?.dispose()
  plane.texture = toTexture(canvas)
  plane.width = canvas.width
  plane.height = canvas.height
  plane.mesh.material.map = plane.texture
  plane.mesh.material.needsUpdate = true

  return true
}

function toTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas)

  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.generateMipmaps = false

  return texture
}
