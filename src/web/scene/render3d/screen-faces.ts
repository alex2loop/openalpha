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

import type { AgendaModel } from '@/web/scene/data/agenda'
import type { Lighting } from '@/web/scene/render3d/lights'
import type { FloorId } from '@/web/scene/types'
import { agenda } from '@/web/scene/data/agenda'
import { type SeeThroughWall, wallHolding } from '@/web/scene/render3d/building'
import { createRoomMaterial } from '@/web/scene/render3d/lights'
import { wallSpotsOf } from '@/web/scene/render3d/props'
import { toUnits } from '@/web/scene/render3d/space'
import {
  type BoardNotes,
  boardNotes,
  createScreenCache,
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
  /** What the faces were last painted from; the same inputs repaint nothing. */
  readonly seen: Seen
  quads: Quad[]
  floor: FloorId | undefined
}

interface Seen {
  model: AgendaModel | undefined
  notes: BoardNotes | undefined
  scale: number
}

interface Quad {
  readonly prop: PropDef
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial | MeshLambertMaterial>
  /** The north wall a hung board fades with. */
  readonly wall?: SeeThroughWall
  key: string
}

/** What the faces follow this frame. */
interface FaceFrame {
  readonly floor: FloorId
  readonly scale: number
  readonly walls: readonly SeeThroughWall[]
}

// The quad stands this far in front of its face plate, so the two never share a plane.
const FACE_LIFT_PX = 0.05

export function createScreenFaces(root: Group, lighting: Lighting): ScreenFaces {
  return {
    root,
    lighting,
    cache: createScreenCache(),
    plane: new PlaneGeometry(1, 1),
    seen: { model: undefined, notes: undefined, scale: 0 },
    quads: [],
    floor: undefined,
  }
}

/** Builds the floor's faces when the floor changes, re-uploads a face whose agenda, notes or zoom
 *  step changed, and fades a hung board with its wall; true when one changed. */
export function syncScreenFaces(faces: ScreenFaces, frame: FaceFrame): boolean {
  const isNewFloor = faces.floor !== frame.floor

  if (isNewFloor) {
    releaseQuads(faces)
    faces.floor = frame.floor
    faces.seen.model = undefined
    faces.quads = propsOn(frame.floor)
      .filter((prop) => faceKindOf(prop) !== undefined)
      .map((prop) => createQuad(faces, { prop, walls: frame.walls }))
  }

  const isRepainted = syncPaint(faces, frame.scale)
  let isFaded = false

  for (const quad of faces.quads) {
    isFaded = fadeWithWall(quad) || isFaded
  }

  return isNewFloor || isRepainted || isFaded
}

export function disposeScreenFaces(faces: ScreenFaces): void {
  releaseQuads(faces)
  faces.cache.release()
  faces.plane.dispose()
}

// Asks the cache for each face only when the agenda, the notes or the zoom moved.
function syncPaint(faces: ScreenFaces, scale: number): boolean {
  const { seen } = faces
  const model = agenda.value
  const notes = boardNotes.value

  if (seen.model === model && seen.notes === notes && seen.scale === scale) {
    return false
  }

  const view = { model, scale, notes }
  let isChanged = false

  seen.model = model
  seen.notes = notes
  seen.scale = scale

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

function fadeWithWall(quad: Quad): boolean {
  const opacity = quad.wall?.opacity ?? 1
  const { material } = quad.mesh

  if (material.opacity === opacity) {
    return false
  }

  material.opacity = opacity
  material.depthWrite = quad.wall?.material.depthWrite ?? true

  return true
}

// A screen glows in its own colours; a cork board takes its room's light like the wall it hangs
// on, and fades with it. The map is set at once so the material never compiles without one.
function createQuad(
  faces: ScreenFaces,
  at: { readonly prop: PropDef; readonly walls: readonly SeeThroughWall[] }
): Quad {
  const { prop } = at
  const map = toTexture(document.createElement('canvas'))
  const spots = wallSpotsOf(prop)
  const wall =
    spots.wallZ === undefined
      ? undefined
      : wallHolding(at.walls, { x: prop.rect.x, wallZ: spots.wallZ })
  const material =
    faceKindOf(prop) === 'agenda'
      ? new MeshBasicMaterial({ map, toneMapped: false, transparent: wall !== undefined })
      : createRoomMaterial(faces.lighting, { map, transparent: wall !== undefined })
  const mesh = new Mesh(faces.plane, material)
  const [x, z, w, d, y, h] = spots.face

  mesh.scale.set(toUnits(w), toUnits(h), 1)
  mesh.position.set(toUnits(x + w / 2), toUnits(y + h / 2), toUnits(z + d + FACE_LIFT_PX))
  faces.root.add(mesh)

  return { prop, mesh, ...(wall === undefined ? {} : { wall }), key: '' }
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
