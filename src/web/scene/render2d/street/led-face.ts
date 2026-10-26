import type { BandItem, LedItem } from '@/web/scene/data/led'
import { sceneZone } from '@/web/scene/clock/clock'
import { FONT } from '@/web/scene/sprites/face-text'
import { LED_TITLE_TONES, stampToneOf } from '@/web/scene/sprites/palette'
import { formatFixed, formatPrice, formatSignedPercent, toneOfPercent } from '@/web/text/figures'
import { formatClock } from '@/web/text/time'
import { tr } from '@/web/text/tr'

export const LED = Object.freeze({
  face: '#070A16',
  head: '#10162B',
  rule: '#5C6690',
  name: '#EEF0FA',
  dim: '#8E94B5',
  dot: '#2C3250',
  dotOn: '#9FB0FF',
  bandBg: '#0B0E1B',
  bandLine: '#2C3250',
  glow: 'rgba(140,124,255,.65)',
})
// The face is laid out for a 44 px high board and scaled to the board's height; the title is 1.75
// times the old 6.4 px.
const REFERENCE_H = 44
const TITLE_PX = 11.2
const TITLE_GLOW_PX = 2.2
const HEAD_H = 13
const LEVEL_DIGITS = 2
const LEVEL_SHRINK_FROM = 8
// Rows of the panel from the head's foot, as shares of the reference scale: label, level, move,
// then the line's top and height.
const ROWS = Object.freeze({ label: 6.5, level: 17.5, move: 28, lineTop: 8, lineH: 17 })
const SIZES = Object.freeze({ label: 6.6, level: 14.5, levelLong: 13, move: 7.4, at: 4.2 })
const PANEL_SHRINK = 0.86
const MID_FONT_WEIGHT = 800
const LINE_SHARE = Object.freeze({ x: 0.66, w: 0.32 })
const STRIP = Object.freeze({ px: 7, gap: 14, weight: 700 })

/** What an item reads on the board: the words or figures of its move, and the colour they take. */
interface Reading {
  readonly move: string
  readonly colour: string
}

/** The words of the move: its signed percent while the market trades, the lunch word at its
 *  break, "closed" outside its session; a move the wire left out reads as nothing. */
function readingOf(item: Pick<LedItem, 'state' | 'changePct'>): Reading {
  if (item.state === 'break') {
    return { move: tr('ui.office.life.lunch'), colour: LED.dim }
  }

  if (item.state === 'closed') {
    return { move: tr('ui.office.led.closed'), colour: LED.dim }
  }

  return {
    move: item.changePct === undefined ? '' : formatSignedPercent(item.changePct),
    colour: directionOf(item),
  }
}

// Colour tells the direction only: the page's up and down colours, or dim when flat or unknown.
function directionOf(item: Pick<LedItem, 'changePct'>): string {
  const tone = toneOfPercent(item.changePct)

  if (tone === 'flat') {
    return LED.dim
  }

  return stampToneOf(tone === 'up' ? 'buy' : 'reduce')
}

/** One board face of `w` by `h` world px under the current scale: the brand strip with the
 *  panel dots, then the item's panel (label and time of its last read, big level, move, and its
 *  line since the page opened); an empty board shows the brand alone. */
export function paintFace(
  g: CanvasRenderingContext2D,
  face: { readonly w: number; readonly h: number; readonly brand: string },
  panel: { readonly items: readonly LedItem[]; readonly index: number }
): void {
  const unit = face.h / REFERENCE_H
  const head = HEAD_H * unit

  g.fillStyle = LED.face
  g.fillRect(0, 0, face.w, face.h)
  g.fillStyle = LED.head
  g.fillRect(0, 0, face.w, head)
  g.fillStyle = LED.rule
  g.fillRect(0, head, face.w, 0.5)
  paintTitle(g, { brand: face.brand, head, unit })
  paintDots(g, { w: face.w, head, unit, count: panel.items.length, on: panel.index })

  const item = panel.items[panel.index]

  if (item === undefined) {
    g.font = `${MID_FONT_WEIGHT} ${12 * unit}px ${FONT}`
    g.textAlign = 'center'
    g.fillStyle = LED_TITLE_TONES[1]
    g.fillText(face.brand, face.w / 2, face.h / 2 + 4 * unit)
  } else {
    paintPanel(g, { item, w: face.w, head, unit })
  }

  g.strokeStyle = LED.rule
  g.lineWidth = 0.8
  g.strokeRect(0.4, 0.4, face.w - 0.8, face.h - 0.8)
}

// The app's name in its mark's blue-violet, with a soft glow under it.
function paintTitle(
  g: CanvasRenderingContext2D,
  at: { readonly brand: string; readonly head: number; readonly unit: number }
): void {
  const y = at.head / 2 + 0.3

  g.font = `${MID_FONT_WEIGHT} ${TITLE_PX * at.unit}px ${FONT}`
  g.textBaseline = 'middle'
  g.textAlign = 'left'

  const ink = g.createLinearGradient(3, 0, 3 + g.measureText(at.brand).width, 0)

  ink.addColorStop(0, LED_TITLE_TONES[0])
  ink.addColorStop(0.5, LED_TITLE_TONES[1])
  ink.addColorStop(1, LED_TITLE_TONES[2])
  g.fillStyle = ink
  g.save()
  g.shadowColor = LED.glow
  g.shadowBlur = TITLE_GLOW_PX * at.unit
  g.fillText(at.brand, 3, y)
  g.restore()
  g.fillText(at.brand, 3, y)
}

function paintDots(
  g: CanvasRenderingContext2D,
  at: {
    readonly w: number
    readonly head: number
    readonly unit: number
    readonly count: number
    readonly on: number
  }
): void {
  for (let i = 0; i < at.count; i++) {
    g.fillStyle = i === at.on ? LED.dotOn : LED.dot
    g.fillRect(at.w - 3 - (at.count - i) * 4.4, at.head / 2 - 0.9 * at.unit, 3.4, 1.8 * at.unit)
  }
}

// The label with the time of the last read, the big level, the move, and the line since the
// page opened with the previous close dashed under it; a stale item draws no line.
function paintPanel(
  g: CanvasRenderingContext2D,
  at: { readonly item: LedItem; readonly w: number; readonly head: number; readonly unit: number }
): void {
  const { item } = at
  const u = at.unit * PANEL_SHRINK
  const reading = readingOf(item)
  const level = formatFixed(item.level, LEVEL_DIGITS)
  const hasLine = !item.stale && item.line.length > 1

  g.textAlign = 'left'
  g.fillStyle = LED.dim
  g.font = `${MID_FONT_WEIGHT} ${SIZES.label * u}px ${FONT}`
  g.fillText(item.label, 4, at.head + ROWS.label * u)

  if (item.at !== undefined) {
    g.font = `${MID_FONT_WEIGHT} ${SIZES.at * u}px ${FONT}`
    g.textAlign = 'right'
    g.fillText(
      tr('ui.office.led.at', { time: formatClock(item.at, sceneZone.value) }),
      at.w - 3,
      at.head + ROWS.label * u,
      at.w * 0.6
    )
    g.textAlign = 'left'
  }

  g.fillStyle = LED.name
  g.font = `${MID_FONT_WEIGHT} ${(level.length > LEVEL_SHRINK_FROM ? SIZES.levelLong : SIZES.level) * u}px ${FONT}`
  g.fillText(level, 4, at.head + ROWS.level * u, hasLine ? at.w * LINE_SHARE.x - 6 : at.w - 8)
  g.fillStyle = reading.colour
  g.font = `${MID_FONT_WEIGHT} ${SIZES.move * u}px ${FONT}`
  g.fillText(reading.move, 4, at.head + ROWS.move * u, at.w - 8)

  if (hasLine) {
    paintLine(g, {
      item,
      colour: reading.colour,
      rect: {
        x: at.w * LINE_SHARE.x,
        y: at.head + ROWS.lineTop * u,
        w: at.w * LINE_SHARE.w - 1,
        h: ROWS.lineH * u,
      },
    })
  }
}

// The levels polled since the page opened, against the previous close.
function paintLine(
  g: CanvasRenderingContext2D,
  at: {
    readonly item: LedItem
    readonly colour: string
    readonly rect: {
      readonly x: number
      readonly y: number
      readonly w: number
      readonly h: number
    }
  }
): void {
  const { item, rect } = at
  const close =
    item.level === undefined || item.changePct === undefined
      ? undefined
      : item.level / (1 + item.changePct / 100)
  const lo = Math.min(close ?? Number.POSITIVE_INFINITY, ...item.line)
  const hi = Math.max(close ?? Number.NEGATIVE_INFINITY, ...item.line)
  const yOf = (value: number): number => rect.y + rect.h - ((value - lo) / (hi - lo || 1)) * rect.h

  if (close !== undefined) {
    g.strokeStyle = LED.dot
    g.lineWidth = 0.4
    g.setLineDash([1, 1])
    g.beginPath()
    g.moveTo(rect.x, yOf(close))
    g.lineTo(rect.x + rect.w, yOf(close))
    g.stroke()
    g.setLineDash([])
  }

  g.strokeStyle = at.colour
  g.lineWidth = 0.9
  g.lineJoin = 'round'
  g.beginPath()

  for (const [index, value] of item.line.entries()) {
    const x = rect.x + (index / (item.line.length - 1)) * rect.w

    if (index === 0) {
      g.moveTo(x, yOf(value))
    } else {
      g.lineTo(x, yOf(value))
    }
  }

  g.stroke()
}

/** One cycle of the scrolling ticker, painted under `g`'s current scale: every item's name, level
 *  and move in a row, `h` high. Size the canvas with `stripWidthOf` first. */
export function paintStrip(
  g: CanvasRenderingContext2D,
  strip: { readonly items: readonly BandItem[]; readonly h: number }
): void {
  g.font = `${STRIP.weight} ${STRIP.px}px ${FONT}`
  g.textBaseline = 'middle'
  g.textAlign = 'left'

  let x = STRIP.gap / 2

  for (const item of strip.items) {
    const parts = stripPartsOf(g, item)

    g.fillStyle = LED.name
    g.fillText(item.label, x, strip.h / 2 + 0.3)
    g.fillStyle = LED.dim
    g.fillText(parts.level, x + parts.nameW, strip.h / 2 + 0.3)
    g.fillStyle = parts.reading.colour
    g.fillText(parts.reading.move, x + parts.nameW + parts.levelW, strip.h / 2 + 0.3)
    x += parts.nameW + parts.levelW + parts.moveW + STRIP.gap
  }
}

/** The width of one cycle of the scrolling ticker, measured on `g`. */
export function stripWidthOf(g: CanvasRenderingContext2D, items: readonly BandItem[]): number {
  g.font = `${STRIP.weight} ${STRIP.px}px ${FONT}`

  return items.reduce((sum, item) => {
    const parts = stripPartsOf(g, item)

    return sum + parts.nameW + parts.levelW + parts.moveW + STRIP.gap
  }, 0)
}

function stripPartsOf(
  g: CanvasRenderingContext2D,
  item: BandItem
): {
  readonly level: string
  readonly reading: Reading
  readonly nameW: number
  readonly levelW: number
  readonly moveW: number
} {
  const level = formatPrice(item.price, item.display)
  const reading = readingOf(item)

  return {
    level,
    reading,
    nameW: g.measureText(`${item.label} `).width,
    levelW: g.measureText(`${level}  `).width,
    moveW: g.measureText(reading.move).width,
  }
}
