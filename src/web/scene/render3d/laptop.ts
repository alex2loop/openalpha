import {
  BoxGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  type Group,
  LinearFilter,
  type Material,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three'

import type { DeskScreenView } from '@/web/scene/overlay-types'
import type { FloorId } from '@/web/scene/types'
import { toUnits } from '@/web/scene/render3d/space'
import { zeroCanvas } from '@/web/scene/renderer'
import { FONT } from '@/web/scene/sprites/face-text'
import { stampToneOf } from '@/web/scene/sprites/palette'

// The analyst's laptop on the meeting table, in front of its seat: a base, a lid leaning back from
// its hinge, and the lid's screen painted with the ticker's line.
const LAPTOP = Object.freeze({
  w: 12,
  d: 8,
  base: 0.6,
  lid: 8,
  lidD: 0.4,
  tilt: -0.35,
  top: 14,
  ahead: 28,
  shell: '#C7CCD4',
})
const SCREEN = Object.freeze({ w: 320, h: 200, inset: 0.6 })
const PANEL = Object.freeze({ body: '#141A36', ink: '#E9ECF8', grid: '#2C3250', pad: 16 })
const FACE_LIFT_PX = 0.05

/** The laptop the analyst works on, shown only while its screen is lit with a line. */
export interface Laptop {
  readonly base: Mesh<BoxGeometry, Material>
  readonly lid: Mesh<BoxGeometry, Material>
  readonly face: Mesh<PlaneGeometry, MeshBasicMaterial>
  readonly canvas: HTMLCanvasElement
  readonly texture: CanvasTexture
  key: string
}

export function createLaptop(root: Group, material: Material): Laptop {
  const canvas = document.createElement('canvas')
  const texture = new CanvasTexture(canvas)
  const laptop: Laptop = {
    base: new Mesh(shellBox(), material),
    lid: new Mesh(shellBox(), material),
    face: new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ map: texture, toneMapped: false })
    ),
    canvas,
    texture,
    key: '',
  }

  canvas.width = SCREEN.w
  canvas.height = SCREEN.h
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.generateMipmaps = false
  laptop.base.scale.set(toUnits(LAPTOP.w), toUnits(LAPTOP.base), toUnits(LAPTOP.d))
  laptop.lid.scale.set(toUnits(LAPTOP.w), toUnits(LAPTOP.lid), toUnits(LAPTOP.lidD))
  laptop.face.scale.set(
    toUnits(LAPTOP.w - 2 * SCREEN.inset),
    toUnits(LAPTOP.lid - 2 * SCREEN.inset),
    1
  )
  laptop.lid.rotation.x = LAPTOP.tilt
  laptop.face.rotation.x = LAPTOP.tilt

  for (const mesh of [laptop.base, laptop.lid, laptop.face]) {
    mesh.visible = false
    root.add(mesh)
  }

  return laptop
}

// A unit box in the shell's colour, for the vertex-coloured room material.
function shellBox(): BoxGeometry {
  const geometry = new BoxGeometry(1, 1, 1)
  const tone = new Color(LAPTOP.shell)
  const count = geometry.getAttribute('position').count

  geometry.setAttribute(
    'color',
    new Float32BufferAttribute(
      Array.from({ length: count }, () => [tone.r, tone.g, tone.b]).flat(),
      3
    )
  )

  return geometry
}

/** Places the laptop before the seat whose screen shows a line on the floor shown, painted again
 *  only when the line moves; hides it otherwise. True when it changed. */
export function syncLaptop(
  laptop: Laptop,
  at: { readonly floor: FloorId; readonly screens: readonly DeskScreenView[] }
): boolean {
  const shown = at.screens.find(
    (screen) => screen.floor === at.floor && screen.content.kind === 'line'
  )
  const key = shown === undefined ? '' : JSON.stringify([shown.seat, shown.content])

  if (key === laptop.key) {
    return false
  }

  laptop.key = key

  for (const mesh of [laptop.base, laptop.lid, laptop.face]) {
    mesh.visible = shown !== undefined
  }

  if (shown !== undefined && shown.content.kind === 'line') {
    place(laptop, shown.seat)
    paintLine(laptop.canvas, shown.content)
    laptop.texture.needsUpdate = true
  }

  return true
}

export function disposeLaptop(laptop: Laptop): void {
  for (const mesh of [laptop.base, laptop.lid, laptop.face]) {
    mesh.removeFromParent()
    mesh.geometry.dispose()
  }

  laptop.face.material.dispose()
  laptop.texture.dispose()
  zeroCanvas(laptop.canvas)
}

// The base lies on the table in front of the seat; the lid stands on its far edge, leaning back.
function place(laptop: Laptop, seat: { readonly x: number; readonly y: number }): void {
  const hinge = seat.y - LAPTOP.ahead - LAPTOP.d
  const up = { y: Math.cos(LAPTOP.tilt), z: Math.sin(LAPTOP.tilt) }
  const out = { y: -Math.sin(LAPTOP.tilt), z: Math.cos(LAPTOP.tilt) }
  const lidY = LAPTOP.top + LAPTOP.base + (up.y * LAPTOP.lid) / 2
  const lidZ = hinge + (up.z * LAPTOP.lid) / 2
  const lift = LAPTOP.lidD / 2 + FACE_LIFT_PX

  laptop.base.position.set(
    toUnits(seat.x),
    toUnits(LAPTOP.top + LAPTOP.base / 2),
    toUnits(hinge + LAPTOP.d / 2)
  )
  laptop.lid.position.set(toUnits(seat.x), toUnits(lidY), toUnits(lidZ))
  laptop.face.position.set(
    toUnits(seat.x),
    toUnits(lidY + out.y * lift),
    toUnits(lidZ + out.z * lift)
  )
}

// The ticker over its closes, the line in the move's direction colour.
function paintLine(
  canvas: HTMLCanvasElement,
  line: { readonly closes: readonly number[]; readonly ticker: string }
): void {
  const c = canvas.getContext('2d')

  if (c === null) {
    return
  }

  const { w, h } = SCREEN
  const { pad } = PANEL
  const lo = Math.min(...line.closes)
  const hi = Math.max(...line.closes)
  const first = line.closes[0] ?? 0
  const last = line.closes.at(-1) ?? first

  c.fillStyle = PANEL.body
  c.fillRect(0, 0, w, h)
  c.fillStyle = PANEL.ink
  c.font = `700 ${h * 0.14}px ${FONT}`
  c.textBaseline = 'top'
  c.fillText(line.ticker, pad, pad)
  c.strokeStyle = stampToneOf(last >= first ? 'buy' : 'reduce')
  c.lineWidth = 4
  c.lineJoin = 'round'
  c.beginPath()

  for (const [i, close] of line.closes.entries()) {
    const x = pad + (i / Math.max(1, line.closes.length - 1)) * (w - 2 * pad)
    const y = h - pad - ((close - lo) / (hi - lo || 1)) * (h * 0.6)

    if (i === 0) {
      c.moveTo(x, y)
    } else {
      c.lineTo(x, y)
    }
  }

  c.stroke()
}
