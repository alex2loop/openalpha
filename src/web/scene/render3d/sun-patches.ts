import {
  AdditiveBlending,
  CanvasTexture,
  type Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three'

import type { Materials } from '@/web/scene/render3d/lights'
import type { GlassSide } from '@/web/scene/sky-types'
import type { SimView } from '@/web/scene/types'
import { GLASS_SIDES } from '@/web/scene/clock/window-light'
import { box, mergeBoxes } from '@/web/scene/render3d/boxes'
import { toUnits, WALL_PX } from '@/web/scene/render3d/space'
import { WORLD } from '@/web/scene/types'
import { WALL_BAND_PX } from '@/web/scene/world/rooms'

// The mockup's warm patch: one soft gradient from the glass inward, added to the floor.
const PATCH = Object.freeze({ tone: 0xffd68c, strength: 0.34, y: 0.96, order: 2.3, texturePx: 64 })
// Each glass side's inner edge on the floor (x or z), its run along the wall, and the turn that
// points the patch inward.
const SIDE = Object.freeze({
  w: { x: 3, z: (WALL_BAND_PX + WORLD.h - 3) / 2, length: WORLD.h - 3 - WALL_BAND_PX, turn: 0 },
  e: {
    x: WORLD.w - 3,
    z: (WALL_BAND_PX + WORLD.h - 3) / 2,
    length: WORLD.h - 3 - WALL_BAND_PX,
    turn: Math.PI,
  },
  n: { x: WORLD.w / 2, z: WALL_BAND_PX, length: WORLD.w, turn: -Math.PI / 2 },
  s: { x: WORLD.w / 2, z: WORLD.h - 3, length: WORLD.w, turn: Math.PI / 2 },
} as const satisfies Record<GlassSide, unknown>)
// The east blinds hang just inside the east glass, as the west ones do inside the west.
const EAST_BLIND = Object.freeze({
  inset: 0.3,
  w: 1.2,
  top: WALL_PX - 1.5,
  drop: WALL_PX - 3,
  tone: '#EDE3CC',
})

/** The sun's warm patches on the floor along the glass it shines through, and the east blinds. */
export interface SunPatches {
  readonly patches: Readonly<Record<GlassSide, Mesh<PlaneGeometry, MeshBasicMaterial>>>
  readonly geometry: PlaneGeometry
  readonly texture: CanvasTexture
  readonly blinds: Mesh
  key: string
}

export function createSunPatches(root: Group, materials: Materials): SunPatches {
  const geometry = new PlaneGeometry(1, 1)
  const texture = createFade()
  const patchOf = (side: GlassSide): Mesh<PlaneGeometry, MeshBasicMaterial> => {
    const mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({
        map: texture,
        color: PATCH.tone,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      })
    )
    // Turned about y to point inward, then laid flat: the gradient runs from the glass into the room.
    mesh.rotation.set(-Math.PI / 2, SIDE[side].turn, 0, 'YXZ')
    mesh.renderOrder = PATCH.order
    mesh.visible = false
    root.add(mesh)

    return mesh
  }
  const blinds = createEastBlinds(root, materials)

  return {
    patches: { w: patchOf('w'), e: patchOf('e'), n: patchOf('n'), s: patchOf('s') },
    geometry,
    texture,
    blinds,
    key: '',
  }
}

/** Lays each patch as deep and as bright as the sun through its glass makes it, and draws the
 *  east blinds; true when something changed. */
export function syncSunPatches(sun: SunPatches, sim: SimView): boolean {
  const light = sim.windowLight
  const key = JSON.stringify([sim.floor, light])

  if (key === sun.key) {
    return false
  }

  sun.key = key

  for (const side of GLASS_SIDES) {
    const mesh = sun.patches[side]
    const strength = light.patch[side]
    const depth = light.depth[side]

    mesh.visible = strength > 0.01
    mesh.material.opacity = strength * PATCH.strength
    mesh.scale.set(toUnits(depth), toUnits(SIDE[side].length), 1)
    placePatch(mesh, { side, depth })
  }

  sun.blinds.visible = light.blind.e > 0
  sun.blinds.scale.y = Math.max(light.blind.e, Number.EPSILON) * EAST_BLIND.drop

  return true
}

export function disposeSunPatches(sun: SunPatches): void {
  for (const side of GLASS_SIDES) {
    sun.patches[side].removeFromParent()
    sun.patches[side].material.dispose()
  }

  sun.blinds.removeFromParent()
  sun.blinds.geometry.dispose()
  sun.geometry.dispose()
  sun.texture.dispose()
}

// The patch's near edge lies on the glass; it reaches `depth` into the room along its inward turn.
function placePatch(mesh: Mesh, at: { readonly side: GlassSide; readonly depth: number }): void {
  const { x, z, turn } = SIDE[at.side]
  const half = at.depth / 2

  mesh.position.set(
    toUnits(x + Math.cos(turn) * half),
    toUnits(PATCH.y),
    toUnits(z - Math.sin(turn) * half)
  )
}

// The east blinds, merged into one mesh hanging from under the ceiling frame, hidden until drawn.
function createEastBlinds(root: Group, materials: Materials): Mesh {
  const blinds = new Mesh(
    mergeBoxes([
      box(
        [
          WORLD.w - EAST_BLIND.inset - EAST_BLIND.w,
          WALL_BAND_PX,
          EAST_BLIND.w,
          WORLD.h - WALL_BAND_PX,
          -1,
          1,
        ],
        EAST_BLIND.tone
      ),
    ]),
    materials.lit
  )

  blinds.position.y = toUnits(EAST_BLIND.top)
  blinds.visible = false
  root.add(blinds)

  return blinds
}

// White at the glass, clear at the far edge, along the texture's x.
function createFade(): CanvasTexture {
  const canvas = document.createElement('canvas')
  const g = canvas.getContext('2d')

  canvas.width = PATCH.texturePx
  canvas.height = 4

  if (g !== null) {
    const fade = g.createLinearGradient(0, 0, PATCH.texturePx, 0)

    fade.addColorStop(0, 'rgba(255,255,255,1)')
    fade.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = fade
    g.fillRect(0, 0, PATCH.texturePx, 4)
  }

  const texture = new CanvasTexture(canvas)

  texture.colorSpace = SRGBColorSpace

  return texture
}
