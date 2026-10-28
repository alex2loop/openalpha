import type { Rect } from '@/web/scene/types'
import {
  cancelRun,
  type PaintRun,
  type PaintStep,
  startRun,
  stepRun,
} from '@/web/scene/render2d/street/paint-run'
import { zeroCanvas } from '@/web/scene/renderer'
import { MAX_ZOOM_3D_PX, movingRectOf, STREET_RECT } from '@/web/scene/view'

// The static canvas stretched past this many times its px reads blurry: the sharp copy takes over.
const SHARP_FROM = 1.25
const MAX_SHARP_CANVAS_PX = 4096
const NO_RECT: Rect = Object.freeze({ x: 0, y: 0, w: 0, h: 0 })
// 3D uploads the copy as a texture: its px steps up through these bands, so a zoom glide repaints
// and uploads it once a band, not every frame.
const BANDS_3D = [2.5, 3.5, 5, 6.5, MAX_ZOOM_3D_PX] as const

/** The static paint again over the visible rect and a margin, at the device's px, for a 2D zoom
 *  closer than the static canvas holds sharp: the signs and the board's lettering stay crisp.
 *  A new copy is painted a few steps a frame onto `scratch`, while the shown one stays. */
export interface SharpLayer {
  readonly canvas: HTMLCanvasElement
  readonly scratch: HTMLCanvasElement
  rect: Rect
  key: string
  /** Moves with each repaint or release, so 3D uploads only a changed copy. */
  version: number
  next: SharpRun | undefined
}

/** The copy being painted: what it is for and how far it is. */
interface SharpRun {
  readonly run: PaintRun
  readonly key: string
  readonly rect: Rect
}

/** What the sharp copy is painted for: the camera, the zoom and the static paint it copies. */
interface SharpJob {
  readonly visible: Rect
  readonly devicePx: number
  readonly staticPx: number
  readonly staticVersion: number
}

/** How one frame advances the copy: the time it may paint until, and the steps of a new paint
 *  (read only when one starts). */
interface SharpFrame {
  readonly until: number
  readonly stepsOf: () => readonly PaintStep[]
}

export function createSharpLayer(): SharpLayer {
  return {
    canvas: document.createElement('canvas'),
    scratch: document.createElement('canvas'),
    rect: NO_RECT,
    key: '',
    version: 0,
    next: undefined,
  }
}

/** Paints the copy a few steps when the static paint or the zoom changed or the camera left its
 *  rect, and shows it once finished; a pan within the margin or a frame with nothing new paints
 *  nothing. True when it painted. */
export function syncSharp(layer: SharpLayer, job: SharpJob, frame: SharpFrame): boolean {
  if (!isWanted(job)) {
    releaseSharp(layer)
    return false
  }

  if (isSharpCurrent(layer, job)) {
    dropNext(layer)
    return false
  }

  const key = keyOf(job)
  const held = layer.next

  if (held === undefined || held.key !== key || !holds(held.rect, job.visible)) {
    layer.next = startNext(layer, job, frame)
  }

  const next = layer.next

  if (next === undefined) {
    return false
  }

  if (stepRun(next.run, frame.until)) {
    layer.rect = next.rect
    layer.key = next.key
    layer.version++
    layer.next = undefined
  }

  return true
}

/** The copy still fits the camera: it is not needed, or painted for this zoom and static paint
 *  over a rect holding the visible street. */
export function isSharpCurrent(layer: SharpLayer, job: SharpJob): boolean {
  if (!isWanted(job)) {
    return layer.canvas.width === 0
  }

  return layer.key === keyOf(job) && holds(layer.rect, job.visible)
}

export function releaseSharp(layer: SharpLayer): void {
  dropNext(layer)

  if (layer.canvas.width === 0) {
    return
  }

  zeroCanvas(layer.canvas)
  layer.rect = NO_RECT
  layer.key = ''
  layer.version++
}

/** The px 3D paints the copy at for `devicePx`: the band at or over it, or 0 while the static
 *  canvas is sharp enough. */
export function sharpPx3d(devicePx: number, staticPx: number): number {
  if (devicePx < staticPx * SHARP_FROM) {
    return 0
  }

  return BANDS_3D.find((band) => band >= devicePx) ?? devicePx
}

function startNext(layer: SharpLayer, job: SharpJob, frame: SharpFrame): SharpRun | undefined {
  const rect = movingRectOf(job.visible)
  const px = Math.min(job.devicePx, MAX_SHARP_CANVAS_PX / Math.max(rect.w, rect.h))
  const run = startRun({
    shown: layer.canvas,
    scratch: layer.scratch,
    rect,
    px,
    steps: frame.stepsOf(),
  })

  return run === undefined ? undefined : { run, key: keyOf(job), rect }
}

function dropNext(layer: SharpLayer): void {
  if (layer.next !== undefined) {
    cancelRun(layer.next.run)
    layer.next = undefined
  }
}

function isWanted(job: SharpJob): boolean {
  return job.devicePx >= job.staticPx * SHARP_FROM
}

function keyOf(job: SharpJob): string {
  return `${job.staticVersion}|${job.devicePx}`
}

// Whether `rect` holds the part of `visible` the street covers.
function holds(rect: Rect, visible: Rect): boolean {
  const x0 = Math.max(STREET_RECT.x, visible.x)
  const y0 = Math.max(STREET_RECT.y, visible.y)
  const x1 = Math.min(STREET_RECT.x + STREET_RECT.w, visible.x + visible.w)
  const y1 = Math.min(STREET_RECT.y + STREET_RECT.h, visible.y + visible.h)

  return x0 >= rect.x && y0 >= rect.y && x1 <= rect.x + rect.w && y1 <= rect.y + rect.h
}
