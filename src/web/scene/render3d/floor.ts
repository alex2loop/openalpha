import { type BufferGeometry, Group, type Material, Mesh } from 'three'

import type { Lighting, Materials } from '@/web/scene/render3d/lights'
import type { FloorId } from '@/web/scene/types'
import { type Box, mergeBoxes } from '@/web/scene/render3d/boxes'
import { buildingBoxes, createFloorPlane, type SeeThroughWall } from '@/web/scene/render3d/building'
import { createRoomMaterial } from '@/web/scene/render3d/lights'
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
}

// Glass draws after everything solid, the curtain glass last.
const GLASS_ORDER = 1
const CURTAIN_ORDER = 1.5

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

    mesh.renderOrder = order
    geometries.push(geometry)
    group.add(mesh)
  }
  const building = buildingBoxes(id)
  const props = buildFloorProps(id)
  const plane = createFloorPlane(id, materials.floor)

  geometries.push(plane.geometry)
  group.add(plane)
  add(building.solid, materials.lit)

  for (const boxes of props.rooms.values()) {
    add(boxes, materials.lit)
  }

  add([...building.glass, ...props.glass], materials.glass, GLASS_ORDER)
  add(building.curtain, materials.curtain, CURTAIN_ORDER)

  const walls = building.north.map((wall) => {
    const material = createRoomMaterial(lighting, { vertexColors: true, transparent: true })

    add(wall.boxes, material)

    return { wall, material, opacity: 1 }
  })

  return { id, group, props, walls, geometries }
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

  materials.floor.map?.dispose()
  materials.floor.map = null
}
