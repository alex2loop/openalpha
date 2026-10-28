import type { Rect } from '@/web/scene/types'
import { SHADOW_REACH_PX } from '@/web/scene/render2d/street/shadow'
import { zeroCanvas } from '@/web/scene/renderer'
import { STREET_RECT } from '@/web/scene/view'

const KEY_SEPARATOR = '|'

/** A slice of the street kept painted between repaints, by name: its canvas and the key of what
 *  it was painted for. */
interface HeldLayer {
  readonly canvas: HTMLCanvasElement
  key: string
}

/** The layers one painter holds for its static canvas. */
export interface StreetLayers {
  readonly held: Map<string, HeldLayer>
}

/** What a layer covers (world px) and every input that changes its pixels. */
interface LayerSpec {
  readonly name: string
  readonly key: string
  readonly rect: Rect
}

/** What a layered painter reads: the canvas it paints on and the layers it may keep. */
interface LayerHost {
  readonly g: CanvasRenderingContext2D
  readonly layers: StreetLayers | undefined
}

/** The device px a layer covers on the canvas it composes onto. */
interface DeviceBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export function createStreetLayers(): StreetLayers {
  return { held: new Map() }
}

export function releaseStreetLayers(layers: StreetLayers): void {
  for (const layer of layers.held.values()) {
    zeroCanvas(layer.canvas)
  }

  layers.held.clear()
}

/** One key from every input that changes a layer's pixels. */
export function layerKeyOf(inputs: readonly (string | number | boolean | undefined)[]): string {
  return inputs.join(KEY_SEPARATOR)
}

/** `rect` and the room its shadows and crowns reach past it. */
export function reachOf(rect: Rect): Rect {
  return {
    x: rect.x - SHADOW_REACH_PX,
    y: rect.y - SHADOW_REACH_PX,
    w: rect.w + 2 * SHADOW_REACH_PX,
    h: rect.h + 2 * SHADOW_REACH_PX,
  }
}

/** Paints `spec`'s slice through `paint` once per key, then composes the held pixels onto the
 *  host's canvas; with no layers, or no context for one, it paints straight onto the canvas. The
 *  slice is aligned to the canvas's device px, so what it composes is what direct painting draws. */
export function paintLayer<Host extends LayerHost>(
  host: Host,
  spec: LayerSpec,
  paint: (host: Host) => void
): void {
  const matrix = host.g.getTransform()
  const box = deviceBoxOf(matrix, spec.rect)
  const held = host.layers === undefined ? undefined : heldLayer(host.layers, spec.name)
  const g = held?.canvas.getContext('2d')

  if (held === undefined || g === null || g === undefined) {
    paint(host)
    return
  }

  const key = layerKeyOf([spec.key, matrix.a, matrix.e, matrix.f])

  if (held.key !== key) {
    // A paint that throws leaves the layer unkeyed, so the next repaint paints it again.
    held.key = ''
    resizeLayer(held.canvas, g, box)
    g.setTransform(matrix.a, 0, 0, matrix.d, matrix.e - box.x, matrix.f - box.y)
    paint({ ...host, g })
    held.key = key
  }

  host.g.save()
  host.g.setTransform(1, 0, 0, 1, 0, 0)
  host.g.drawImage(held.canvas, box.x, box.y)
  host.g.restore()
}

function heldLayer(layers: StreetLayers, name: string): HeldLayer {
  const held = layers.held.get(name) ?? { canvas: document.createElement('canvas'), key: '' }

  layers.held.set(name, held)

  return held
}

function deviceBoxOf(matrix: DOMMatrix, rect: Rect): DeviceBox {
  const left = Math.max(rect.x, STREET_RECT.x)
  const top = Math.max(rect.y, STREET_RECT.y)
  const right = Math.min(rect.x + rect.w, STREET_RECT.x + STREET_RECT.w)
  const bottom = Math.min(rect.y + rect.h, STREET_RECT.y + STREET_RECT.h)
  const x = Math.floor(matrix.a * left + matrix.e)
  const y = Math.floor(matrix.d * top + matrix.f)

  return {
    x,
    y,
    w: Math.max(1, Math.ceil(matrix.a * right + matrix.e) - x),
    h: Math.max(1, Math.ceil(matrix.d * bottom + matrix.f) - y),
  }
}

function resizeLayer(canvas: HTMLCanvasElement, g: CanvasRenderingContext2D, box: DeviceBox): void {
  if (canvas.width === box.w && canvas.height === box.h) {
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, box.w, box.h)
    return
  }

  canvas.width = box.w
  canvas.height = box.h
}
