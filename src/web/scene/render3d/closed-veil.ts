import { Mesh, MeshBasicMaterial, PlaneGeometry, type Scene } from 'three'

import type { FloorId } from '@/web/scene/types'
import { toUnits, WALL_PX } from '@/web/scene/render3d/space'
import { CLOSED_ROOM } from '@/web/scene/sprites/daylight'
import { roomById, WALL_BAND_PX } from '@/web/scene/world/rooms'

// The mockup's veil over a shut lobby: a dark sheet over its floor at this height, and one down
// its back wall.
const VEIL = Object.freeze({ tone: '#14182C', opacity: 0.28, risePx: 38.4, wallProudPx: 0.6 })

/** The dark veil the mockup lays over the lobby while the home market is shut for the day. */
export interface ClosedVeil {
  readonly meshes: readonly Mesh[]
  readonly material: MeshBasicMaterial
  readonly geometry: PlaneGeometry
  shown: boolean
  dispose(): void
}

export function createClosedVeil(scene: Scene): ClosedVeil {
  const material = new MeshBasicMaterial({
    color: VEIL.tone,
    transparent: true,
    opacity: VEIL.opacity,
    depthWrite: false,
  })
  const geometry = new PlaneGeometry(1, 1)
  const floor = new Mesh(geometry, material)
  const wall = new Mesh(geometry, material)

  placeVeil({ floor, wall })
  floor.visible = false
  wall.visible = false
  scene.add(floor, wall)

  return {
    meshes: [floor, wall],
    material,
    geometry,
    shown: false,
    dispose() {
      floor.removeFromParent()
      wall.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}

// The floor sheet over the lobby under its wall band, and the sheet down its back wall.
function placeVeil(veil: { readonly floor: Mesh; readonly wall: Mesh }): void {
  const room = roomById(CLOSED_ROOM)

  if (room === undefined) {
    return
  }

  const { x, y, w, h } = room.rect
  const depth = h - WALL_BAND_PX

  veil.floor.rotation.x = -Math.PI / 2
  veil.floor.scale.set(toUnits(w), toUnits(depth), 1)
  veil.floor.position.set(
    toUnits(x + w / 2),
    toUnits(VEIL.risePx),
    toUnits(y + WALL_BAND_PX + depth / 2)
  )
  veil.wall.scale.set(toUnits(w), toUnits(WALL_PX), 1)
  veil.wall.position.set(
    toUnits(x + w / 2),
    toUnits(WALL_PX / 2),
    toUnits(y + WALL_BAND_PX + VEIL.wallProudPx)
  )
}

/** Shows the veil while the lobby's floor is shown and the market is shut; true when it changed. */
export function syncClosedVeil(
  veil: ClosedVeil,
  at: { readonly floor: FloorId; readonly isClosed: boolean }
): boolean {
  const isShown = at.isClosed && roomById(CLOSED_ROOM)?.floor === at.floor

  if (veil.shown === isShown) {
    return false
  }

  veil.shown = isShown

  for (const mesh of veil.meshes) {
    mesh.visible = isShown
  }

  return true
}
