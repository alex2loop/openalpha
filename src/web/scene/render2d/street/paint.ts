import type { Rect, StreetFrame, StreetView } from '@/web/scene/types'
import type { RegionPack } from '@/web/scene/world/regions'
import type { ClockParts } from '@/web/text/time'
import { regionPack } from '@/web/scene/data/home'
import { CITY_PART } from '@/web/scene/render2d/street/city'
import {
  detailOfPx,
  releaseStreetSprites,
  type StreetDetail,
  staticPxOf,
} from '@/web/scene/render2d/street/detail'
import { zeroCanvas } from '@/web/scene/renderer'
import { DAY_LIGHT_HOUR } from '@/web/scene/sprites/daylight'
import { projection, STREET_RECT } from '@/web/scene/view'
import { lightByHour } from '@/web/state/prefs'
import { locale } from '@/web/state/session'
import { MINUTES_PER_HOUR } from '@/web/text/time-units'

const MAX_MOVING_CANVAS_PX = 2048
// The moving canvas reaches this share of the visible rect past each of its sides, so a small pan
// between two steps stays inside it.
const MOVING_MARGIN = 0.25
const KEY_SEPARATOR = '|'
const NO_RECT: Rect = Object.freeze({ x: 0, y: 0, w: 0, h: 0 })

/** The page minute a part paints, and the detail level it paints at. */
export interface StreetMinute extends ClockParts {
  readonly detail: StreetDetail
}

/** One part of the street: what it paints once a minute on the static canvas, and what it paints
 *  each step on the moving canvas over `rect`; both in world px. */
export interface PaintPart {
  paintStatic(g: CanvasRenderingContext2D, pack: RegionPack, minute: StreetMinute): void
  paintMoving?(g: CanvasRenderingContext2D, view: StreetView, rect: Rect): void
}

type MovingPaint = NonNullable<PaintPart['paintMoving']>

// Every part of the street, in draw order.
const PAINT_PARTS: readonly PaintPart[] = [CITY_PART]
const MOVING_PAINTS: readonly MovingPaint[] = PAINT_PARTS.flatMap((part) =>
  part.paintMoving === undefined ? [] : [part.paintMoving]
)

/** The one street painter both renderers read: `paint` repaints only what changed and returns
 *  the frame; `paintMs` is the last static repaint's time. */
export interface StreetPainter {
  paint(view: StreetView, visible: Rect, minute: ClockParts): StreetFrame
  paintMs(): number
  release(): void
}

interface PainterState {
  readonly staticCanvas: HTMLCanvasElement
  readonly movingCanvas: HTMLCanvasElement
  staticKey: string
  staticVersion: number
  movingKey: string
  movingVersion: number
  movingRect: Rect
  paintMs: number
}

export function createStreetPainter(): StreetPainter {
  const state: PainterState = {
    staticCanvas: document.createElement('canvas'),
    movingCanvas: document.createElement('canvas'),
    staticKey: '',
    staticVersion: 0,
    movingKey: '',
    movingVersion: 0,
    movingRect: NO_RECT,
    paintMs: 0,
  }

  return {
    paint(view, visible, minute) {
      const devicePx = projection.value.scale * devicePixelRatio

      syncStatic(state, toStreetMinute(minute, detailOfPx(devicePx)))
      syncMoving(state, { view, visible, devicePx })

      return {
        staticCanvas: state.staticCanvas,
        movingCanvas: state.movingCanvas,
        movingRect: state.movingRect,
        staticVersion: state.staticVersion,
        movingVersion: state.movingVersion,
      }
    },
    paintMs: () => state.paintMs,
    release() {
      zeroCanvas(state.staticCanvas)
      zeroCanvas(state.movingCanvas)
      releaseStreetSprites()
      state.staticKey = ''
      state.movingKey = ''
    },
  }
}

// The street keeps the office's light: with the light not following the hour, its day row.
function toStreetMinute(minute: ClockParts, detail: StreetDetail): StreetMinute {
  return lightByHour.value
    ? { ...minute, detail }
    : { ...minute, minute: DAY_LIGHT_HOUR * MINUTES_PER_HOUR, detail }
}

// Repainted when the minute, the day, the pack, the language or the detail level changes.
function syncStatic(state: PainterState, minute: StreetMinute): void {
  const pack = regionPack.value
  const key = [Math.floor(minute.minute), minute.day, pack.id, locale.value, minute.detail].join(
    KEY_SEPARATOR
  )
  const g = state.staticCanvas.getContext('2d')

  if (key === state.staticKey || g === null) {
    return
  }

  const startedAt = performance.now()
  const px = staticPxOf(minute.detail)

  resizeCanvas(state.staticCanvas, { w: STREET_RECT.w * px, h: STREET_RECT.h * px })
  g.setTransform(px, 0, 0, px, -STREET_RECT.x * px, -STREET_RECT.y * px)
  g.clearRect(STREET_RECT.x, STREET_RECT.y, STREET_RECT.w, STREET_RECT.h)

  for (const part of PAINT_PARTS) {
    part.paintStatic(g, pack, minute)
  }

  state.staticKey = key
  state.staticVersion++
  state.paintMs = performance.now() - startedAt
}

// Cleared and redrawn over the visible rect after each step that moved something; zero-sized
// while nothing does.
function syncMoving(
  state: PainterState,
  job: { readonly view: StreetView; readonly visible: Rect; readonly devicePx: number }
): void {
  const rect = toMovingRect(job.visible)
  const isEmpty = rect.w <= 0 || rect.h <= 0 || !hasMovers(job.view)

  if (isEmpty) {
    clearMoving(state)
    return
  }

  const px = Math.min(job.devicePx, MAX_MOVING_CANVAS_PX / Math.max(rect.w, rect.h))
  const key = [job.view.step, rect.x, rect.y, rect.w, rect.h, px].join(KEY_SEPARATOR)
  const g = state.movingCanvas.getContext('2d')

  if (key === state.movingKey || g === null) {
    return
  }

  resizeCanvas(state.movingCanvas, { w: rect.w * px, h: rect.h * px })
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.clearRect(0, 0, state.movingCanvas.width, state.movingCanvas.height)
  g.setTransform(px, 0, 0, px, -rect.x * px, -rect.y * px)

  for (const paintMoving of MOVING_PAINTS) {
    paintMoving(g, job.view, rect)
  }

  state.movingRect = rect
  state.movingKey = key
  state.movingVersion++
}

function hasMovers(view: StreetView): boolean {
  return MOVING_PAINTS.length > 0 && Object.values(view.pools).some((pool) => pool.length > 0)
}

function clearMoving(state: PainterState): void {
  if (state.movingCanvas.width === 0) {
    return
  }

  zeroCanvas(state.movingCanvas)
  state.movingRect = NO_RECT
  state.movingKey = ''
  state.movingVersion++
}

// The visible rect with its margin, inside the street.
function toMovingRect(visible: Rect): Rect {
  const x0 = Math.max(STREET_RECT.x, visible.x - visible.w * MOVING_MARGIN)
  const y0 = Math.max(STREET_RECT.y, visible.y - visible.h * MOVING_MARGIN)
  const x1 = Math.min(STREET_RECT.x + STREET_RECT.w, visible.x + visible.w * (1 + MOVING_MARGIN))
  const y1 = Math.min(STREET_RECT.y + STREET_RECT.h, visible.y + visible.h * (1 + MOVING_MARGIN))

  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}

function resizeCanvas(
  canvas: HTMLCanvasElement,
  size: { readonly w: number; readonly h: number }
): void {
  const width = Math.max(1, Math.ceil(size.w))
  const height = Math.max(1, Math.ceil(size.h))

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
}
