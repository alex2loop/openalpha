import { type BufferGeometry, DoubleSide, Group, type Material, Mesh } from 'three'

import type { Lighting, Materials } from '@/web/scene/render3d/lights'
import type { FloorId } from '@/web/scene/types'
import { type Box, mergeBoxes } from '@/web/scene/render3d/boxes'
import {
  buildingBoxes,
  createFloorPlane,
  type SeeThroughWall,
  wallHolding,
} from '@/web/scene/render3d/building'
import { addDeskBoxes } from '@/web/scene/render3d/desk-items'
import { createRoomMaterial } from '@/web/scene/render3d/lights'
import { buildMugsGeometry } from '@/web/scene/render3d/mug-shape'
import { buildFloorProps, type FloorProps } from '@/web/scene/render3d/props'

/** One floor's static picture: the building merged once, each room's furniture merged once, the
 *  north walls that clear over a hidden walker, and the furniture parts that change while it
 *  shows. */
export interface FloorScene {
  readonly id: FloorId
  readonly group: Group
  readonly props: FloorProps
  readonly walls: readonly SeeThroughWall[]
  readonly geometries: readonly BufferGeometry[]
  /** Materials made for this floor alone. */
  readonly materials: readonly Material[]
}

// Glass draws after everything solid, the curtain glass last.
const GLASS_ORDER = 1
const CURTAIN_ORDER = 1.5
const MUG_ROUGHNESS = 0.45

export function buildFloor(id: FloorId, lighting: Lighting): FloorScene {
  const { materials } = lighting
  const group = new Group()
  const geometries: BufferGeometry[] = []
  const add = (boxes: readonly Box[], material: Material, order = 0) => {
    if (boxes.length === 0) {
      return
    }

    const geometry = mergeBoxes(boxes)
    const mesh = new Mesh(geometry, material)
    const isSolid = order === 0

    mesh.renderOrder = order
    mesh.castShadow = isSolid
    mesh.receiveShadow = isSolid
    geometries.push(geometry)
    group.add(mesh)
  }
  const building = buildingBoxes(id)
  const props = buildFloorProps(id)

  addDeskBoxes(props.rooms, id)

  const plane = createFloorPlane(id, materials.floor)

  plane.receiveShadow = true
  geometries.push(plane.geometry)
  group.add(plane)
  add(building.solid, materials.lit)

  for (const boxes of props.rooms.values()) {
    add(boxes, materials.lit)
  }

  add([...building.glass, ...props.glass], materials.glass, GLASS_ORDER)
  add(building.curtain, materials.curtain, CURTAIN_ORDER)

  const mugs = addMugs(lighting, { group, geometries, spots: props.mugs })

  const walls = buildWalls(lighting, { north: building.north, props, add })

  return { id, group, props, walls, geometries, materials: mugs === undefined ? [] : [mugs] }
}

// Each north wall with the pieces hung on it, under its own material so they fade together; a
// piece on no fading wall joins the rest.
function buildWalls(
  lighting: Lighting,
  at: {
    readonly north: ReturnType<typeof buildingBoxes>['north']
    readonly props: FloorProps
    readonly add: (boxes: readonly Box[], material: Material) => void
  }
): SeeThroughWall[] {
  const walls = at.north.map((wall) => ({
    wall,
    material: createRoomMaterial(lighting, { vertexColors: true, transparent: true }),
    opacity: 1,
  }))
  const held = new Map(walls.map((one) => [one, [...one.wall.boxes]]))
  const loose: Box[] = []

  for (const piece of at.props.hung) {
    const wall = wallHolding(walls, piece)
    const boxes = (wall === undefined ? undefined : held.get(wall)) ?? loose

    boxes.push(...piece.boxes)
  }

  at.add(loose, lighting.materials.lit)

  for (const [one, boxes] of held) {
    at.add(boxes, one.material)
  }

  return walls
}

// The floor's turned mugs as one mesh: open cups show their inside, so both faces draw.
function addMugs(
  lighting: Lighting,
  at: {
    readonly group: Group
    readonly geometries: BufferGeometry[]
    readonly spots: FloorProps['mugs']
  }
): Material | undefined {
  const geometry = buildMugsGeometry(at.spots)

  if (geometry === undefined) {
    return undefined
  }

  const material = createRoomMaterial(lighting, {
    vertexColors: true,
    roughness: MUG_ROUGHNESS,
    side: DoubleSide,
  })
  const mesh = new Mesh(geometry, material)

  mesh.castShadow = true
  mesh.receiveShadow = true
  at.geometries.push(geometry)
  at.group.add(mesh)

  return material
}

/** Frees the floor's geometries, its walls' materials and its surface texture. */
export function disposeFloor(floor: FloorScene, materials: Materials): void {
  floor.group.removeFromParent()

  for (const geometry of floor.geometries) {
    geometry.dispose()
  }

  for (const one of floor.walls) {
    one.material.dispose()
  }

  for (const material of floor.materials) {
    material.dispose()
  }

  materials.floor.map?.dispose()
  materials.floor.map = null
}
