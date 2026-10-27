import { FONT } from '@/web/scene/sprites/face-text'

/** Where and how a line of crisp text sits: `x` is its left edge (its right edge for `'right'`),
 *  `y` the top of its line box, both in world px; `fontPx` is world px and `perPx` the device px
 *  a world px is painted at. */
interface CrispLine {
  readonly x: number
  readonly y: number
  readonly fontPx: number
  readonly perPx: number
  readonly color: string
  readonly align?: 'left' | 'right'
  /** The widest the line may be, in world px; wider text is squeezed. */
  readonly maxW?: number
}

const WEIGHT = 600
// An antialiased pixel at least this opaque counts as ink.
const INK_ALPHA = 100
const OPAQUE = 255
const PAD_DEVICE_PX = 1
const BASELINE_SHARE = 1.02
const LINE_SHARE = 1.4

let scratch: CanvasRenderingContext2D | null | undefined

/** Paints `text` as the mockup's monitors do: rasterised at a whole device size, then every pixel
 *  made wholly ink or wholly clear, so the strokes stay crisp however the floor is stretched.
 *  Returns the width it took, in world px. */
export function paintCrispText(g: CanvasRenderingContext2D, text: string, at: CrispLine): number {
  const s = scratchOf()

  if (s === null) {
    return 0
  }

  const size = Math.max(1, Math.round(at.fontPx * at.perPx))
  const font = `${WEIGHT} ${size}px ${FONT}`

  s.font = font

  const maxDevice = at.maxW === undefined ? Number.POSITIVE_INFINITY : at.maxW * at.perPx
  const textW = Math.min(s.measureText(text).width, maxDevice)
  const w = Math.ceil(textW) + PAD_DEVICE_PX * 2
  const h = Math.ceil(size * LINE_SHARE)

  fitCanvas(s.canvas, w, h)
  s.clearRect(0, 0, w, h)
  s.font = font
  s.fillStyle = at.color
  s.textAlign = 'left'
  s.textBaseline = 'alphabetic'
  s.fillText(text, PAD_DEVICE_PX, Math.round(size * BASELINE_SHARE), maxDevice)
  solidify(s, w, h)

  const left = at.align === 'right' ? at.x - (w - PAD_DEVICE_PX) / at.perPx : at.x
  const dx = Math.round((left - PAD_DEVICE_PX / at.perPx) * at.perPx) / at.perPx
  const dy = Math.round(at.y * at.perPx) / at.perPx

  g.save()
  g.imageSmoothingEnabled = false
  g.drawImage(s.canvas, 0, 0, w, h, dx, dy, w / at.perPx, h / at.perPx)
  g.restore()

  return textW / at.perPx
}

// The one scratch canvas every line is rasterised on; it only grows.
function scratchOf(): CanvasRenderingContext2D | null {
  scratch ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })

  return scratch
}

function fitCanvas(canvas: HTMLCanvasElement, w: number, h: number): void {
  if (canvas.width < w) {
    canvas.width = w
  }

  if (canvas.height < h) {
    canvas.height = h
  }
}

function solidify(s: CanvasRenderingContext2D, w: number, h: number): void {
  const image = s.getImageData(0, 0, w, h)
  const px = image.data

  for (let i = 3; i < px.length; i += 4) {
    px[i] = (px[i] ?? 0) >= INK_ALPHA ? OPAQUE : 0
  }

  s.putImageData(image, 0, 0)
}
