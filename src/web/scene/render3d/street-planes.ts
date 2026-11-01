import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
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

// The planes lie just under the floor plane, the sharp copy over the static one and the moving
// one over both, so the building's own floor always wins.
const GROUND_DROP = 0.02
const SHARP_DROP = 0.015
const MOVING_DROP = 0.01
const UPLOAD_GAP_MS = MS_PER_SECOND / SMALL_MOTION_RENDERS_PER_S
// Drawn before the moving plane, which sorts by depth among the other see-through pieces.
const SHARP_ORDER = -1
// A layer painted near the screen's px is never shrunk far: no mipmaps for it.
const NO_MIPMAPS = 0
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

/** The street in 3D: the static canvas on the ground, its sharp copy over the visible part at a
 *  close zoom, and the moving one over its rect. Nothing else in 3D owns street state. */
export interface StreetPlanes {
  readonly ground: StreetPlane
  readonly sharp: StreetPlane
  readonly moving: StreetPlane
  /** The GPU's anisotropy, for the ground seen at a slant from far out. */
  readonly anisotropy: number
  sharpAt: number
  movingAt: number
}

/** A canvas on its plane: its paint's version and the rect it covers. */
interface Layer {
  readonly canvas: HTMLCanvasElement
  readonly version: number
  readonly rect: Rect
}

export function createStreetPlanes(scene: Scene, anisotropy: number): StreetPlanes {
  const ground = createPlane({ isTransparent: false })
  const sharp = createPlane({ isTransparent: true })
  const moving = createPlane({ isTransparent: true })

  sharp.mesh.renderOrder = SHARP_ORDER
  placePlane(ground.mesh, { rect: STREET_RECT, drop: GROUND_DROP })
  scene.add(ground.mesh, sharp.mesh, moving.mesh)

  return {
    ground,
    sharp,
    moving,
    anisotropy,
    sharpAt: Number.NEGATIVE_INFINITY,
    movingAt: Number.NEGATIVE_INFINITY,
  }
}

/** Uploads a canvas only when its version moved, the sharp and moving ones at most
 *  `SMALL_MOTION_RENDERS_PER_S` times a second; `isPending` while one of those waits. */
export function syncStreetPlanes(
  planes: StreetPlanes,
  at: { readonly frame: StreetFrame; readonly now: number }
): { readonly isChanged: boolean; readonly isPending: boolean } {
  const { frame, now } = at
  const isGroundNew = syncPlane(planes.ground, {
    canvas: frame.staticCanvas,
    version: frame.staticVersion,
    anisotropy: planes.anisotropy,
  })
  const sharp = syncLayer(planes.sharp, {
    layer: { canvas: frame.sharpCanvas, version: frame.sharpVersion, rect: frame.sharpRect },
    drop: SHARP_DROP,
    lastAt: planes.sharpAt,
    now,
  })
  const moving = syncLayer(planes.moving, {
    layer: { canvas: frame.movingCanvas, version: frame.movingVersion, rect: frame.movingRect },
    drop: MOVING_DROP,
    lastAt: planes.movingAt,
    now,
  })

  planes.sharpAt = sharp.isUploaded ? now : planes.sharpAt
  planes.movingAt = moving.isUploaded ? now : planes.movingAt

  return {
    isChanged: isGroundNew || sharp.isUploaded || moving.isUploaded,
    isPending: sharp.isHeld || moving.isHeld,
  }
}

// A layer over its own rect, uploaded with its placement so the two never part.
function syncLayer(
  plane: StreetPlane,
  at: {
    readonly layer: Layer
    readonly drop: number
    readonly lastAt: number
    readonly now: number
  }
): { readonly isUploaded: boolean; readonly isHeld: boolean } {
  const { layer } = at
  const isDue = layer.version !== plane.version
  const isHeld = isDue && at.now - at.lastAt < UPLOAD_GAP_MS

  if (!isDue || isHeld) {
    return { isUploaded: false, isHeld }
  }

  syncPlane(plane, { canvas: layer.canvas, version: layer.version, anisotropy: NO_MIPMAPS })
  placePlane(plane.mesh, { rect: layer.rect, drop: at.drop })

  return { isUploaded: true, isHeld: false }
}

export function disposeStreetPlanes(planes: StreetPlanes): void {
  for (const plane of [planes.ground, planes.sharp, planes.moving]) {
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
function syncPlane(
  plane: StreetPlane,
  at: { readonly canvas: HTMLCanvasElement; readonly version: number; readonly anisotropy: number }
): boolean {
  const { canvas, version } = at

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
  plane.texture = toTexture(canvas, at.anisotropy)
  plane.width = canvas.width
  plane.height = canvas.height
  plane.mesh.material.map = plane.texture
  plane.mesh.material.needsUpdate = true

  return true
}

// The ground is seen from far out, shrunk and at a slant: mipmaps and the GPU's anisotropy keep
// its lettering from shimmering. The sharp and moving copies are painted near the screen's px.
function toTexture(canvas: HTMLCanvasElement, anisotropy: number): CanvasTexture {
  const texture = new CanvasTexture(canvas)
  const isMipmapped = anisotropy !== NO_MIPMAPS

  texture.colorSpace = SRGBColorSpace
  texture.magFilter = LinearFilter
  texture.minFilter = isMipmapped ? LinearMipmapLinearFilter : LinearFilter
  texture.generateMipmaps = isMipmapped
  texture.anisotropy = Math.max(1, anisotropy)

  return texture
}
