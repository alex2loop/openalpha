import type { PaintRun } from '@/web/scene/render2d/street/paint-run'
import type { SunView, WeatherNow } from '@/web/scene/sky-types'
import type { StreetFrame, StreetView } from '@/web/scene/street-types'
import type { Rect } from '@/web/scene/types'
import type { RegionPack } from '@/web/scene/world/regions'
import type { ClockParts } from '@/web/text/time'
import { STREET_PAINT_SLICE_MS } from '@/web/scene/budgets'
import { regionPack } from '@/web/scene/data/home'
import { weather } from '@/web/scene/data/weather'
import {
  detailOfPx,
  releaseStreetSprites,
  type StreetDetail,
  staticPxOf,
} from '@/web/scene/render2d/street/detail'
import {
  createStreetLayers,
  releaseStreetLayers,
  type StreetLayers,
} from '@/web/scene/render2d/street/layer-cache'
import { releaseLedFaces } from '@/web/scene/render2d/street/led-board'
import { MOVING_PAINTS, staticStepsOf } from '@/web/scene/render2d/street/parts'
import {
  createSharpLayer,
  isSharpCurrent,
  releaseSharp,
  type SharpLayer,
  sharpPx3d,
  syncSharp,
} from '@/web/scene/render2d/street/sharp'
import { notePaintMs, syncStatic } from '@/web/scene/render2d/street/static-paint'
import { zeroCanvas } from '@/web/scene/renderer'
import { type SkyNow, skyNow } from '@/web/scene/sim/sky'
import { hasStreetEntities } from '@/web/scene/sim/street/street'
import { type LightRow, lightOf } from '@/web/scene/sprites/daylight'
import { spriteBuildSkips } from '@/web/scene/sprites/sprite-cache'
import { FRAME_RECT, movingRectOf, projection } from '@/web/scene/view'
import { sceneView } from '@/web/state/prefs'
import { locale } from '@/web/state/session'

const MAX_MOVING_CANVAS_PX = 2048
const KEY_SEPARATOR = '|'
const NO_RECT: Rect = Object.freeze({ x: 0, y: 0, w: 0, h: 0 })
// Under this much of a world px above the framed view, the camera still counts as framing it.
const REVEAL_SLACK_PX = 0.5

/** The minute a part paints at (the light's minute, held at solar noon when the light does not
 *  follow the hour), the page minute `clock` that opening hours follow, the detail level, whether
 *  the camera shows the sky above the framed view, the light and the sun it comes from, and the
 *  weather; and the `layers` it may keep slices in between minutes, none on a canvas painted at
 *  another px than the static one's. */
export interface StreetMinute extends ClockParts {
  readonly clock: number
  readonly layers: StreetLayers | undefined
  readonly detail: StreetDetail
  readonly isRevealed: boolean
  readonly light: LightRow
  readonly sun: SunView
  readonly weather: WeatherNow
}

/** What a moving part paints over: the moving canvas's rect and its px per world px, the minute
 *  the static canvas last painted, and the pack. */
export interface MovingScene {
  readonly rect: Rect
  readonly px: number
  readonly minute: StreetMinute
  readonly pack: RegionPack
}

/** One part of the street: what it paints once a minute on the static canvas, and what it paints
 *  each step on the moving canvas over the scene's rect; both in world px. */
export interface PaintPart {
  paintStatic(g: CanvasRenderingContext2D, pack: RegionPack, minute: StreetMinute): void
  paintMoving?(g: CanvasRenderingContext2D, view: StreetView, scene: MovingScene): void
}

/** The one street painter both renderers read: `paint` repaints only what changed, a few steps a
 *  frame, and returns the frame; `paintMs` is the longest frame the last repaint took. */
export interface StreetPainter {
  paint(view: StreetView, visible: Rect, minute: ClockParts): StreetFrame
  /** The frame just drawn still fits the camera its draw placed: the detail level, and the
   *  moving canvas's rect is the one `visible` asks for, and no repaint is still going. False
   *  after a zoom or pan the paint ran ahead of. */
  isCurrent(visible: Rect): boolean
  paintMs(): number
  release(): void
}

export interface PainterState {
  readonly moving: { rect: Rect; px: number; minute: StreetMinute; pack: RegionPack }
  /** The sky the light row was read for, so it is read once a page minute. */
  sky: SkyNow | undefined
  light: LightRow
  readonly staticCanvas: HTMLCanvasElement
  /** Where the static repaint in `staticRun` paints before it is copied onto `staticCanvas`. */
  readonly staticScratch: HTMLCanvasElement
  staticRun: PaintRun | undefined
  readonly movingCanvas: HTMLCanvasElement
  readonly sharp: SharpLayer
  readonly layers: StreetLayers
  staticKey: string
  detail: StreetDetail | undefined
  staticVersion: number
  movingKey: string
  movingVersion: number
  movingRect: Rect
  paintMs: number
  /** The last frame painted a step of a repaint, so one more must follow. */
  isPainting: boolean
  /** The moving canvas left out a sprite it had no time to build, so one more paint must follow. */
  isMovingPartial: boolean
}

export function createStreetPainter(): StreetPainter {
  const state = createPainterState()

  return {
    paint: (view, visible, minute) => paintStreet(state, { view, visible, minute }),
    isCurrent: (visible) =>
      state.detail === detailOfPx(projection.value.scale * devicePixelRatio) &&
      !state.isPainting &&
      !state.isMovingPartial &&
      state.moving.minute.isRevealed === isRevealedBy(visible) &&
      isSharpCurrent(state.sharp, sharpJobOf(state, visible)) &&
      (state.movingCanvas.width === 0 || isSameRect(movingRectOf(visible), state.movingRect)),
    paintMs: () => state.paintMs,
    release() {
      zeroCanvas(state.staticCanvas)
      zeroCanvas(state.staticScratch)
      zeroCanvas(state.movingCanvas)
      releaseSharp(state.sharp)
      releaseStreetLayers(state.layers)
      releaseStreetSprites()
      releaseLedFaces()
      state.staticRun = undefined
      state.staticKey = ''
      state.movingKey = ''
      state.isMovingPartial = false
      state.detail = undefined
    },
  }
}

// The static canvas when its minute or look changed, its sharp copy for a close 2D zoom, then the
// moving canvas over the visible rect. The first two paint a few steps a frame, within one slice.
function paintStreet(
  state: PainterState,
  job: { readonly view: StreetView; readonly visible: Rect; readonly minute: ClockParts }
): StreetFrame {
  const { view, visible, minute } = job
  const devicePx = projection.value.scale * devicePixelRatio
  const startedAt = performance.now()
  const until = startedAt + STREET_PAINT_SLICE_MS
  const isStaticPainted = syncStatic(
    state,
    toStreetMinute(state, {
      minute,
      detail: detailOfPx(devicePx),
      isRevealed: isRevealedBy(visible),
    }),
    until
  )
  // The copy is of the finished static paint, so it waits for it.
  const isSharpPainted =
    state.staticRun === undefined &&
    syncSharp(state.sharp, sharpJobOf(state, visible), {
      until,
      stepsOf: () =>
        staticStepsOf(state.moving.pack, { ...state.moving.minute, layers: undefined }),
    })

  const isPainting = isStaticPainted || isSharpPainted

  notePaintMs(state, startedAt, isPainting)

  // A frame that painted leaves the moving canvas to the next, so none runs over budget.
  if (!isPainting) {
    syncMoving(state, { view, visible, devicePx })
  }

  return {
    staticCanvas: state.staticCanvas,
    movingCanvas: state.movingCanvas,
    movingRect: state.movingRect,
    sharpCanvas: state.sharp.canvas,
    sharpRect: state.sharp.rect,
    staticVersion: state.staticVersion,
    sharpVersion: state.sharp.version,
    movingVersion: state.movingVersion,
    isPainting,
  }
}

function createPainterState(): PainterState {
  return {
    moving: {
      rect: NO_RECT,
      px: 1,
      minute: {
        day: '',
        minute: 0,
        clock: 0,
        layers: undefined,
        dow: 0,
        detail: 0,
        isRevealed: false,
        light: lightOf(skyNow.peek().light),
        sun: skyNow.peek().light.sun,
        weather: weather.peek(),
      },
      pack: regionPack.value,
    },
    sky: undefined,
    light: lightOf(skyNow.peek().light),
    staticCanvas: document.createElement('canvas'),
    staticScratch: document.createElement('canvas'),
    staticRun: undefined,
    movingCanvas: document.createElement('canvas'),
    sharp: createSharpLayer(),
    layers: createStreetLayers(),
    staticKey: '',
    detail: undefined,
    staticVersion: 0,
    movingKey: '',
    movingVersion: 0,
    movingRect: NO_RECT,
    paintMs: 0,
    isPainting: false,
    isMovingPartial: false,
  }
}

// The street keeps the sky's light un-eased, read once a page minute, and its minute.
function toStreetMinute(
  state: PainterState,
  at: { readonly minute: ClockParts; readonly detail: StreetDetail; readonly isRevealed: boolean }
): StreetMinute {
  const sky = skyNow.value

  if (sky !== state.sky) {
    state.sky = sky
    state.light = lightOf(sky.light)
  }

  return {
    ...at.minute,
    minute: sky.minute,
    clock: at.minute.minute,
    layers: state.layers,
    detail: at.detail,
    isRevealed: at.isRevealed,
    light: state.light,
    sun: sky.light.sun,
    weather: weather.value,
  }
}

// 2D paints the sharp copy at the device's px; 3D lays it as a texture over its ground, at the
// zoom's band, so a glide repaints it once a band.
function sharpJobOf(state: PainterState, visible: Rect) {
  const devicePx = projection.value.scale * devicePixelRatio
  const staticPx = staticPxOf(detailOfPx(devicePx))

  return {
    visible,
    devicePx: sceneView.value === '2d' ? devicePx : sharpPx3d(devicePx, staticPx),
    staticPx,
    staticVersion: state.staticVersion,
  }
}

// Cleared and redrawn over the visible rect after each step that moved something; zero-sized
// while nothing does.
function syncMoving(
  state: PainterState,
  job: { readonly view: StreetView; readonly visible: Rect; readonly devicePx: number }
): void {
  const rect = movingRectOf(job.visible)
  const isEmpty = rect.w <= 0 || rect.h <= 0 || !hasMovers(job.view, rect)

  if (isEmpty) {
    clearMoving(state)
    return
  }

  const px = Math.min(job.devicePx, MAX_MOVING_CANVAS_PX / Math.max(rect.w, rect.h))
  const key = [
    job.view.step,
    rect.x,
    rect.y,
    rect.w,
    rect.h,
    px,
    Math.floor(state.moving.minute.minute),
    locale.value,
  ].join(KEY_SEPARATOR)
  const g = state.movingCanvas.getContext('2d')

  if (key === state.movingKey || g === null) {
    return
  }

  resizeCanvas(state.movingCanvas, { w: rect.w * px, h: rect.h * px })
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.clearRect(0, 0, state.movingCanvas.width, state.movingCanvas.height)
  g.setTransform(px, 0, 0, px, -rect.x * px, -rect.y * px)

  state.moving.rect = rect
  state.moving.px = px
  const skipsBefore = spriteBuildSkips()

  for (const paintMoving of MOVING_PAINTS) {
    paintMoving(g, job.view, state.moving)
  }

  // A sprite the frame had no time to build is left out, and the next frame paints it.
  state.isMovingPartial = spriteBuildSkips() !== skipsBefore
  state.movingRect = rect
  state.movingKey = state.isMovingPartial ? '' : key
  state.movingVersion++
}

// The camera shows the sky above the framed view: the city's back rows stand there, as the mockup's
// sky strip shows once the camera leaves its default framing.
function isRevealedBy(visible: Rect): boolean {
  return visible.y < FRAME_RECT.y - REVEAL_SLACK_PX
}

function hasMovers(view: StreetView, rect: Rect): boolean {
  return MOVING_PAINTS.length > 0 && hasStreetEntities(view, rect)
}

function isSameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

function clearMoving(state: PainterState): void {
  if (state.movingCanvas.width === 0) {
    return
  }

  zeroCanvas(state.movingCanvas)
  state.movingRect = NO_RECT
  state.movingKey = ''
  state.isMovingPartial = false
  state.movingVersion++
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
