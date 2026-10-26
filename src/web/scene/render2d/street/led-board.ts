import type { BandItem, LedItem } from '@/web/scene/data/led'
import type { MovingScene } from '@/web/scene/render2d/street/paint'
import type { BoardView } from '@/web/scene/street-types'
import type { Rect } from '@/web/scene/types'
import { bandItems, ledItems } from '@/web/scene/data/led'
import { LED, paintFace, paintStrip, stripWidthOf } from '@/web/scene/render2d/street/led-face'
import { zeroCanvas } from '@/web/scene/renderer'
import { brand, locale } from '@/web/state/session'

/** Close zoom keeps at most this many finished board faces; the oldest is dropped and zeroed. */
const MAX_LED_FACES = 24
const MAX_SCALE = 10
const HALO_FROM_DARK = 0.3
const HALO_ALPHA = 0.2
const HALO_PAD = 3
const PULSE = Object.freeze({ rgb: '159,176,255', alpha: 0.5, reach: 16 })
const BAND_INSET = 0.8

/** What the face memo holds: the picture and what it was painted for. */
interface FaceMemo {
  readonly items: readonly LedItem[]
  readonly panel: number
  readonly scale: number
  readonly minute: number
  readonly language: string
  readonly name: string
  readonly canvas: HTMLCanvasElement
}

interface StripMemo {
  readonly items: readonly BandItem[]
  readonly scale: number
  readonly language: string
  readonly canvas: HTMLCanvasElement
  readonly w: number
}

// Oldest first: past the cap the first entry goes.
const faces = new Map<string, HTMLCanvasElement>()
let faceMemo: FaceMemo | undefined
let stripMemo: StripMemo | undefined

/** The board's live parts over the frontage's static housing: the halo and the hour's pulse, the
 *  face (the panel now showing, a cached vector picture at the zoom's scale) and the ticker band
 *  (the page tape's names, scrolling while one of their markets is open, standing otherwise). */
export function paintBoard(
  g: CanvasRenderingContext2D,
  at: { readonly scene: MovingScene; readonly board: BoardView; readonly rects: BoardRects }
): void {
  const items = ledItems.value
  const { board, scene } = at
  const dark = scene.minute.light.dark

  paintHalo(g, { rect: at.rects.board, dark, pulse: board.pulse })

  const scale = Math.min(MAX_SCALE, Math.max(1, Math.ceil(scene.px)))
  const panel = items.length === 0 ? 0 : board.panel % items.length
  const face = faceOf(at.rects.board, {
    items,
    panel,
    scale,
    minute: Math.floor(scene.minute.clock),
  })

  if (face !== undefined) {
    g.drawImage(face, at.rects.board.x, at.rects.board.y, at.rects.board.w, at.rects.board.h)
  }

  paintBand(g, { rect: at.rects.band, items: bandItems.value, scale, scrollPx: board.scrollPx })
}

/** The board's and the band's rects on the frontage's face. */
interface BoardRects {
  readonly board: Rect
  readonly band: Rect
}

/** Zeroes every cached face and the strip. */
export function releaseLedFaces(): void {
  for (const canvas of faces.values()) {
    zeroCanvas(canvas)
  }

  faces.clear()
  faceMemo = undefined

  if (stripMemo !== undefined) {
    zeroCanvas(stripMemo.canvas)
    stripMemo = undefined
  }
}

// A faint halo round the lit board after dusk, and a soft swell of light at the top of the hour.
function paintHalo(
  g: CanvasRenderingContext2D,
  at: { readonly rect: Rect; readonly dark: number; readonly pulse: number }
): void {
  const { rect } = at

  if (at.dark > HALO_FROM_DARK) {
    g.globalAlpha = HALO_ALPHA * at.dark
    g.fillStyle = LED.dotOn
    g.fillRect(rect.x - HALO_PAD, rect.y - HALO_PAD, rect.w + 2 * HALO_PAD, rect.h + 2 * HALO_PAD)
    g.globalAlpha = 1
  }

  if (at.pulse > 0) {
    const cx = rect.x + rect.w / 2
    const cy = rect.y + rect.h / 2
    const radius = Math.max(rect.w, rect.h) / 2 + PULSE.reach
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, radius)

    glow.addColorStop(0, `rgba(${PULSE.rgb},${PULSE.alpha * at.pulse})`)
    glow.addColorStop(1, `rgba(${PULSE.rgb},0)`)
    g.fillStyle = glow
    g.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
  }
}

// The face for these figures, panel, scale and minute: the memo of the last one, else the cache,
// else a fresh vector painting.
function faceOf(
  rect: Rect,
  want: {
    readonly items: readonly LedItem[]
    readonly panel: number
    readonly scale: number
    readonly minute: number
  }
): HTMLCanvasElement | undefined {
  const language = locale.value
  const name = brand.value ?? ''
  const held = faceMemo

  if (
    held !== undefined &&
    held.items === want.items &&
    held.panel === want.panel &&
    held.scale === want.scale &&
    held.minute === want.minute &&
    held.language === language &&
    held.name === name
  ) {
    return held.canvas
  }

  const key = [signatureOf(want.items), want.panel, want.scale, want.minute, language, name].join(
    '#'
  )
  const canvas = faces.get(key) ?? createFace(key, rect, { ...want, name })

  if (canvas !== undefined) {
    faceMemo = { ...want, language, name, canvas }
  }

  return canvas
}

function createFace(
  key: string,
  rect: Rect,
  want: {
    readonly items: readonly LedItem[]
    readonly panel: number
    readonly scale: number
    readonly name: string
  }
): HTMLCanvasElement | undefined {
  const canvas = document.createElement('canvas')
  const g = canvas.getContext('2d')

  if (g === null) {
    return undefined
  }

  canvas.width = Math.ceil(rect.w * want.scale)
  canvas.height = Math.ceil(rect.h * want.scale)
  g.scale(want.scale, want.scale)
  paintFace(g, { w: rect.w, h: rect.h, brand: want.name }, { items: want.items, index: want.panel })
  faces.set(key, canvas)

  if (faces.size > MAX_LED_FACES) {
    const [oldestKey, oldest] = faces.entries().next().value ?? []

    if (oldestKey !== undefined && oldest !== undefined) {
      zeroCanvas(oldest)
      faces.delete(oldestKey)
    }
  }

  return canvas
}

// Everything a face shows of the figures, as one string.
function signatureOf(items: readonly LedItem[]): string {
  return items
    .map((item) =>
      [
        item.label,
        item.level,
        item.changePct,
        item.state,
        item.stale,
        item.at,
        item.line.length,
      ].join(',')
    )
    .join(';')
}

// The band: its frame, then the strip, `scrollPx` along (none while it stands).
function paintBand(
  g: CanvasRenderingContext2D,
  at: {
    readonly rect: Rect
    readonly items: readonly BandItem[]
    readonly scale: number
    readonly scrollPx: number
  }
): void {
  const { rect } = at

  g.fillStyle = LED.bandBg
  g.fillRect(rect.x, rect.y, rect.w, rect.h)
  g.strokeStyle = LED.bandLine
  g.lineWidth = 0.6
  g.strokeRect(rect.x + 0.3, rect.y + 0.3, rect.w - 0.6, rect.h - 0.6)

  if (at.items.length === 0) {
    return
  }

  g.save()
  g.beginPath()
  g.rect(rect.x + BAND_INSET, rect.y + BAND_INSET, rect.w - 2 * BAND_INSET, rect.h - 2 * BAND_INSET)
  g.clip()
  paintScroll(g, at)
  g.restore()
}

function paintScroll(
  g: CanvasRenderingContext2D,
  at: {
    readonly rect: Rect
    readonly items: readonly BandItem[]
    readonly scale: number
    readonly scrollPx: number
  }
): void {
  const strip = stripOf(g, { items: at.items, scale: at.scale, h: at.rect.h - 2 * BAND_INSET })

  if (strip === undefined || strip.w <= 0) {
    return
  }

  const h = at.rect.h - 2 * BAND_INSET

  for (
    let x = at.rect.x + BAND_INSET - (at.scrollPx % strip.w);
    x < at.rect.x + at.rect.w;
    x += strip.w
  ) {
    g.drawImage(strip.canvas, x, at.rect.y + BAND_INSET, strip.w, h)
  }
}

// One cycle of the strip, painted once per figures, language and scale.
function stripOf(
  g: CanvasRenderingContext2D,
  want: { readonly items: readonly BandItem[]; readonly scale: number; readonly h: number }
): StripMemo | undefined {
  const language = locale.value
  const held = stripMemo

  if (
    held !== undefined &&
    held.items === want.items &&
    held.scale === want.scale &&
    held.language === language
  ) {
    return held
  }

  if (held !== undefined) {
    zeroCanvas(held.canvas)
  }

  stripMemo = undefined

  const w = stripWidthOf(g, want.items)
  const canvas = document.createElement('canvas')
  const c = canvas.getContext('2d')

  if (c === null || w <= 0) {
    return undefined
  }

  canvas.width = Math.ceil(w * want.scale)
  canvas.height = Math.ceil(want.h * want.scale)
  c.scale(want.scale, want.scale)
  paintStrip(c, { items: want.items, h: want.h })
  stripMemo = { items: want.items, scale: want.scale, language, canvas, w }

  return stripMemo
}
