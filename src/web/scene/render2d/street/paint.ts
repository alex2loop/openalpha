import type { SunView, WeatherNow } from '@/web/scene/sky-types'
import type { StreetFrame, StreetView } from '@/web/scene/street-types'
import type { Rect } from '@/web/scene/types'
import type { RegionPack } from '@/web/scene/world/regions'
import type { ClockParts } from '@/web/text/time'
import { regionPack } from '@/web/scene/data/home'
import { weather } from '@/web/scene/data/weather'
import { CITY_PART } from '@/web/scene/render2d/street/city'
import {
  detailOfPx,
  releaseStreetSprites,
  type StreetDetail,
  staticPxOf,
} from '@/web/scene/render2d/street/detail'
import { FESTIVE_PART } from '@/web/scene/render2d/street/festive'
import { FRONTAGE_PART } from '@/web/scene/render2d/street/frontage'
import { releaseLedFaces } from '@/web/scene/render2d/street/led-board'
import { MOVERS_PART } from '@/web/scene/render2d/street/movers'
import { PARK_PART } from '@/web/scene/render2d/street/park'
import {
  createSharpLayer,
  isSharpCurrent,
  releaseSharp,
  type SharpLayer,
  sharpPx3d,
  syncSharp,
} from '@/web/scene/render2d/street/sharp'
import { SHELTERS_PART } from '@/web/scene/render2d/street/shelters'
import { SHOPS_PART } from '@/web/scene/render2d/street/shops'
import { SIGNALS_PART } from '@/web/scene/render2d/street/signals'
import { VENDORS_PART } from '@/web/scene/render2d/street/vendors'
import { WEATHER_PART } from '@/web/scene/render2d/street/weather'
import { zeroCanvas } from '@/web/scene/renderer'
import { type SkyNow, skyNow } from '@/web/scene/sim/sky'
import { hasStreetEntities } from '@/web/scene/sim/street/street'
import { type LightRow, lightOf } from '@/web/scene/sprites/daylight'
import { FRAME_RECT, movingRectOf, projection, STREET_RECT } from '@/web/scene/view'
import { reducedMotion, sceneView } from '@/web/state/prefs'
import { locale } from '@/web/state/session'

const MAX_MOVING_CANVAS_PX = 2048
const KEY_SEPARATOR = '|'
const NO_RECT: Rect = Object.freeze({ x: 0, y: 0, w: 0, h: 0 })
// Under this much of a world px above the framed view, the camera still counts as framing it.
const REVEAL_SLACK_PX = 0.5

/** The minute a part paints at (the light's minute, held at solar noon when the light does not
 *  follow the hour), the page minute `clock` that opening hours follow, the detail level, whether
 *  the camera shows the sky above the framed view, the light and the sun it comes from, and the
 *  weather. */
export interface StreetMinute extends ClockParts {
  readonly clock: number
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

type MovingPaint = NonNullable<PaintPart['paintMoving']>

// Every part of the street, in draw order.
const PAINT_PARTS: readonly PaintPart[] = [
  CITY_PART,
  PARK_PART,
  SHOPS_PART,
  FRONTAGE_PART,
  FESTIVE_PART,
  SIGNALS_PART,
  SHELTERS_PART,
  VENDORS_PART,
  MOVERS_PART,
  WEATHER_PART,
]
const MOVING_PAINTS: readonly MovingPaint[] = PAINT_PARTS.flatMap((part) =>
  part.paintMoving === undefined ? [] : [part.paintMoving]
)

/** The one street painter both renderers read: `paint` repaints only what changed and returns
 *  the frame; `paintMs` is the last static repaint's time. */
export interface StreetPainter {
  paint(view: StreetView, visible: Rect, minute: ClockParts): StreetFrame
  /** The frame just drawn still fits the camera its draw placed: the detail level, and the
   *  moving canvas's rect is the one `visible` asks for. False after a zoom or pan the paint ran
   *  ahead of. */
  isCurrent(visible: Rect): boolean
  paintMs(): number
  release(): void
}

interface PainterState {
  readonly moving: { rect: Rect; px: number; minute: StreetMinute; pack: RegionPack }
  /** The sky the light row was read for, so it is read once a page minute. */
  sky: SkyNow | undefined
  light: LightRow
  readonly staticCanvas: HTMLCanvasElement
  readonly movingCanvas: HTMLCanvasElement
  readonly sharp: SharpLayer
  staticKey: string
  detail: StreetDetail | undefined
  staticVersion: number
  movingKey: string
  movingVersion: number
  movingRect: Rect
  paintMs: number
}

export function createStreetPainter(): StreetPainter {
  const state = createPainterState()

  return {
    paint: (view, visible, minute) => paintStreet(state, { view, visible, minute }),
    isCurrent: (visible) =>
      state.detail === detailOfPx(projection.value.scale * devicePixelRatio) &&
      state.moving.minute.isRevealed === isRevealedBy(visible) &&
      isSharpCurrent(state.sharp, sharpJobOf(state, visible)) &&
      (state.movingCanvas.width === 0 || isSameRect(movingRectOf(visible), state.movingRect)),
    paintMs: () => state.paintMs,
    release() {
      zeroCanvas(state.staticCanvas)
      zeroCanvas(state.movingCanvas)
      releaseSharp(state.sharp)
      releaseStreetSprites()
      releaseLedFaces()
      state.staticKey = ''
      state.movingKey = ''
      state.detail = undefined
    },
  }
}

// The static canvas when its minute or look changed, its sharp copy for a close 2D zoom, then the
// moving canvas over the visible rect.
function paintStreet(
  state: PainterState,
  job: { readonly view: StreetView; readonly visible: Rect; readonly minute: ClockParts }
): StreetFrame {
  const { view, visible, minute } = job
  const devicePx = projection.value.scale * devicePixelRatio

  syncStatic(
    state,
    toStreetMinute(state, {
      minute,
      detail: detailOfPx(devicePx),
      isRevealed: isRevealedBy(visible),
    })
  )
  syncSharp(state.sharp, sharpJobOf(state, visible), (g) =>
    paintParts(g, state.moving.pack, state.moving.minute)
  )
  syncMoving(state, { view, visible, devicePx })

  return {
    staticCanvas: state.staticCanvas,
    movingCanvas: state.movingCanvas,
    movingRect: state.movingRect,
    sharpCanvas: state.sharp.canvas,
    sharpRect: state.sharp.rect,
    staticVersion: state.staticVersion,
    sharpVersion: state.sharp.version,
    movingVersion: state.movingVersion,
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
    movingCanvas: document.createElement('canvas'),
    sharp: createSharpLayer(),
    staticKey: '',
    detail: undefined,
    staticVersion: 0,
    movingKey: '',
    movingVersion: 0,
    movingRect: NO_RECT,
    paintMs: 0,
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
    detail: at.detail,
    isRevealed: at.isRevealed,
    light: state.light,
    sun: sky.light.sun,
    weather: weather.value,
  }
}

// Repainted when the minute, the day, the pack, the language, the detail level, the camera's
// reveal of the sky above the frame, the sky or the weather changes.
function syncStatic(state: PainterState, minute: StreetMinute): void {
  const pack = regionPack.value
  const key = [
    Math.floor(minute.minute),
    Math.floor(minute.clock),
    minute.day,
    pack.id,
    locale.value,
    minute.detail,
    minute.isRevealed,
    reducedMotion.value,
  ].join(KEY_SEPARATOR)
  const g = state.staticCanvas.getContext('2d')
  const isSame =
    key === state.staticKey &&
    minute.light === state.moving.minute.light &&
    minute.weather === state.moving.minute.weather

  if (isSame) {
    return
  }

  state.detail = minute.detail
  state.moving.minute = minute
  state.moving.pack = pack

  if (g === null) {
    return
  }

  const startedAt = performance.now()
  const px = staticPxOf(minute.detail)

  resizeCanvas(state.staticCanvas, { w: STREET_RECT.w * px, h: STREET_RECT.h * px })
  g.setTransform(px, 0, 0, px, -STREET_RECT.x * px, -STREET_RECT.y * px)
  g.clearRect(STREET_RECT.x, STREET_RECT.y, STREET_RECT.w, STREET_RECT.h)

  paintParts(g, pack, minute)
  state.staticKey = key
  state.staticVersion++
  state.paintMs = performance.now() - startedAt
}

function paintParts(g: CanvasRenderingContext2D, pack: RegionPack, minute: StreetMinute): void {
  for (const part of PAINT_PARTS) {
    part.paintStatic(g, pack, minute)
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

  for (const paintMoving of MOVING_PAINTS) {
    paintMoving(g, job.view, state.moving)
  }

  state.movingRect = rect
  state.movingKey = key
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
