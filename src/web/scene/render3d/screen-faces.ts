import {
  CanvasTexture,
  type Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  type MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three'

import type { Lighting } from '@/web/scene/render3d/lights'
import type { FloorId } from '@/web/scene/types'
import { agenda } from '@/web/scene/data/agenda'
import { createRoomMaterial } from '@/web/scene/render3d/lights'
import { wallSpotsOf } from '@/web/scene/render3d/props'
import { toUnits } from '@/web/scene/render3d/space'
import {
  boardNotesOf,
  createScreenCache,
  type FaceView,
  faceKindOf,
  type ScreenCache,
} from '@/web/scene/sprites/screens'
import { type PropDef, propsOn } from '@/web/scene/world/props'

/** The floor's agenda screens and cork boards as quads over their props' face plates, painted by
 *  the same face painters as 2D and uploaded only when a face's signature changes. */
export interface ScreenFaces {
  readonly root: Group
  readonly lighting: Lighting
  readonly cache: ScreenCache
  readonly plane: PlaneGeometry
  quads: Quad[]
  floor: FloorId | undefined
}

interface Quad {
  readonly prop: PropDef
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial | MeshLambertMaterial>
  key: string
}

// The quad stands this far in front of its face plate, so the two never share a plane.
const FACE_LIFT_PX = 0.05

export function createScreenFaces(root: Group, lighting: Lighting): ScreenFaces {
  return {
    root,
    lighting,
    cache: createScreenCache(),
    plane: new PlaneGeometry(1, 1),
    quads: [],
    floor: undefined,
  }
}

/** Builds the floor's faces when the floor changes and re-uploads a face whose agenda, notes or
 *  zoom step changed; true when one did. */
export function syncScreenFaces(
  faces: ScreenFaces,
  frame: { readonly floor: FloorId; readonly scale: number }
): boolean {
  const view: FaceView = { model: agenda.value, scale: frame.scale, notes: boardNotesOf() }
  const isNewFloor = faces.floor !== frame.floor
  let isChanged = isNewFloor

  if (isNewFloor) {
    releaseQuads(faces)
    faces.floor = frame.floor
    faces.quads = propsOn(frame.floor)
      .filter((prop) => faceKindOf(prop) !== undefined)
      .map((prop) => createQuad(faces, prop))
  }

  for (const quad of faces.quads) {
    const face = faces.cache.faceOf(quad.prop, view)

    if (face !== undefined && face.key !== quad.key) {
      quad.mesh.material.map?.dispose()
      quad.mesh.material.map = toTexture(face.canvas)
      quad.key = face.key
      isChanged = true
    }
  }

  return isChanged
}

export function disposeScreenFaces(faces: ScreenFaces): void {
  releaseQuads(faces)
  faces.cache.release()
  faces.plane.dispose()
}

// A screen glows in its own colours; a cork board takes its room's light like the wall it hangs
// on. The map is set at once so the material never compiles without one.
function createQuad(faces: ScreenFaces, prop: PropDef): Quad {
  const map = toTexture(document.createElement('canvas'))
  const material =
    faceKindOf(prop) === 'agenda'
      ? new MeshBasicMaterial({ map, toneMapped: false })
      : createRoomMaterial(faces.lighting, { map })
  const mesh = new Mesh(faces.plane, material)
  const [x, z, w, d, y, h] = wallSpotsOf(prop).face

  mesh.scale.set(toUnits(w), toUnits(h), 1)
  mesh.position.set(toUnits(x + w / 2), toUnits(y + h / 2), toUnits(z + d + FACE_LIFT_PX))
  faces.root.add(mesh)

  return { prop, mesh, key: '' }
}

function releaseQuads(faces: ScreenFaces): void {
  for (const quad of faces.quads) {
    quad.mesh.removeFromParent()
    quad.mesh.material.map?.dispose()
    quad.mesh.material.dispose()
  }

  faces.quads = []
}

function toTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas)

  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.generateMipmaps = false

  return texture
}
