import type { StreetDetail } from '@/web/scene/render2d/street/detail'
import type { ShopKind } from '@/web/scene/street-types'
import { measureLabel, paintLabel } from '@/web/scene/render2d/street/label'
import { isNightDark, mixTone, NIGHT_TONE } from '@/web/scene/render2d/street/tone'
import { SHOP_RISE, type ShopSpan } from '@/web/scene/world/frontage'
import { isAllDay, type ShopSign } from '@/web/scene/world/regions'
import { formatHourOfDay } from '@/web/text/time'
import { MINUTES_PER_HOUR } from '@/web/text/time-units'
import { tr } from '@/web/text/tr'

const SIGN_H = 4.2
const AWNING_H = 1.6
const WALL = '#CDC6B8'
const WALL_NIGHT = 0.5
// A sign lights once the dark passes its own mark, so the row lights one shop at a time.
const LIT_FROM_DARK = 0.15
const LIT_BUCKETS = 9
const LIT_STEP = 0.055
const GLOW_ALPHA = 0.3
const SHUT_NIGHT = { closed: 0.4, open: 0 }
const SHUTTER = Object.freeze({
  slat: '#8B93A3',
  line: 'rgba(0,0,0,.22)',
  edge: '#5E6575',
  handle: '#C9CED8',
  lineGap: 1.2,
})
const WINDOW = Object.freeze({
  glass: '#7FA3B8',
  glassNight: '#1E2434',
  lit: '#FFE3A6',
  door: '#BFD8E4',
  doorLit: '#FFF1CC',
  frame: '#3B4254',
})
const DOOR_W = Object.freeze({ min: 2.4, max: 4.2, share: 0.34 })
const GOODS = ['#E8643A', '#4E9FD1', '#F2C94C', '#6FBF73', '#C95A8A'] as const
const SHELF = '#7C7468'
const NOTE = Object.freeze({ paper: '#F3F0E6', ink: '#2A2F3F', minWidth: 8, maxWidth: 8.8 })
const OPEN247 = '#D8453B'
// A pharmacy's sign carries a cross before its word.
const CROSS_SHIFT = 1.6
// The sign's word fills its band: one line up to `size`, or, where that leaves it smaller, broken
// at a space into two lines up to `twoLineSize`, `lineStep` apart; `inset` is the band's margin.
const WORD = Object.freeze({ size: 2.3, twoLineSize: 1.7, lineStep: 1.85, inset: 1.6, rise: 0.1 })
// Lettering is measured at this size and scaled, as a canvas font rounds at a world px size.
const MEASURE_PX = 10
const WORD_SEPARATOR = ' '

// The tube that lights round a sign after dusk, by kind.
const NEON: Readonly<Partial<Record<ShopKind, string>>> = Object.freeze({
  bar: '#FF5FA2',
  cafe: '#FFC24A',
  pharmacy: '#4DFF9A',
  bank: '#7DE3A6',
  food: '#FF8A4D',
  store: '#FFFFFF',
})
const PLAIN_SIGN: ShopSign = Object.freeze({ band: '#8A93A6', ink: '#FFFFFF' })
const TABLE = Object.freeze({ leg: '#6B6B75', top: '#F2EFE6', minWidth: 10, at: [0.27, 0.74] })

/** A shop front's colours: its sign band and the ink on it, and its awning stripes. */
interface KindLook {
  readonly band: string
  readonly ink: string
  readonly awning: readonly [string, string]
}

/** One shop front to paint, with `g` standing at the front's foot (its left end, on the pavement
 *  line): the span, whether it serves, the dark, the detail, and the front's word (none for a
 *  shutter row). `drop`, while a shutter moves, is how far down it is. */
interface ShopPaint {
  readonly span: ShopSpan
  readonly isOpen: boolean
  readonly dark: number
  readonly detail: StreetDetail
  readonly word: string | undefined
  readonly drop?: number
}

interface ShopFront {
  readonly g: CanvasRenderingContext2D
  readonly shop: ShopPaint
  readonly w: number
  readonly look: KindLook
  readonly isLit: boolean
  tone(hex: string, share: number): string
}

const TOP = -SHOP_RISE
const WINDOW_TOP = TOP + SIGN_H + AWNING_H

export function paintShop(g: CanvasRenderingContext2D, shop: ShopPaint): void {
  const { span } = shop
  const kind = span.row.kind
  const front: ShopFront = {
    g,
    shop,
    w: span.w,
    look: lookOf(span.row.sign ?? PLAIN_SIGN),
    isLit: shop.isOpen && shop.dark > LIT_FROM_DARK + (Math.round(span.x) % LIT_BUCKETS) * LIT_STEP,
    tone: (hex, share) => mixTone(hex, NIGHT_TONE, shop.dark * share),
  }

  g.fillStyle = front.tone(WALL, WALL_NIGHT)
  g.fillRect(0, TOP, span.w, SHOP_RISE + 2)

  if (kind === 'alley') {
    paintAlley(front)
    return
  }

  paintSign(front)

  const isMoving = shop.drop !== undefined && shop.drop > 0

  if (shop.isOpen || isMoving) {
    paintOpenFront(front)
  }

  if (!shop.isOpen || isMoving) {
    paintShutter(front, isMoving ? (shop.drop ?? 1) : 1)
  }

  g.fillStyle = 'rgba(0,0,0,.18)'
  g.fillRect(0, 1.4, span.w, 0.6)

  if (span.row.tables === true && shop.isOpen && shop.detail > 0 && span.w >= TABLE.minWidth) {
    paintTables(front)
  }
}

function lookOf(sign: ShopSign): KindLook {
  return { band: sign.band, ink: sign.ink, awning: sign.awning ?? [sign.band, sign.ink] }
}

// Two café tables out on the pavement, a stool either side of each.
function paintTables(front: ShopFront): void {
  const { g, w, look } = front

  for (const share of TABLE.at) {
    const x = w * share

    g.fillStyle = front.tone(TABLE.leg, 0.5)
    g.fillRect(x - 0.15, 3.4, 0.3, 1.2)
    g.fillStyle = front.tone(look.awning[0], 0.5)
    g.fillRect(x - 2.4, 3.6, 0.8, 0.9)
    g.fillRect(x - 2.4, 2.8, 0.8, 0.5)
    g.fillRect(x + 1.6, 3.6, 0.8, 0.9)
    g.fillRect(x + 1.6, 2.8, 0.8, 0.5)
    g.fillStyle = front.tone(TABLE.top, 0.5)
    g.beginPath()
    g.ellipse(x, 3.4, 1.4, 0.7, 0, 0, Math.PI * 2)
    g.fill()
  }
}

// A dark opening between two fronts; a light far in after dusk.
function paintAlley(front: ShopFront): void {
  const { g, w } = front

  g.fillStyle = front.tone('#2A2F3F', 0.5)
  g.fillRect(0.6, TOP + 3, w - 1.2, SHOP_RISE - 1)
  g.fillStyle = front.tone('#1B1F2C', 0.5)
  g.fillRect(1.4, TOP + 5, w - 2.8, SHOP_RISE - 3)

  if (isNightDark(front.shop.dark)) {
    g.fillStyle = 'rgba(255,226,160,.55)'
    g.fillRect(w / 2 - 0.5, TOP + 4.5, 1, 1)
  }
}

// The sign band: the kind's colour, its word (from the middle detail up; one ink bar below that)
// and, lit, a glow and the kind's tube.
function paintSign(front: ShopFront): void {
  const { g, w, look, shop } = front
  const tone = signTone(front)

  if (front.isLit) {
    g.globalAlpha = GLOW_ALPHA
    g.fillStyle = look.band
    g.fillRect(-1, TOP - 1, w + 2, SIGN_H + 2)
    g.globalAlpha = 1
  }

  g.fillStyle = tone(look.band)
  g.fillRect(0, TOP, w, SIGN_H)

  if (shop.detail === 0) {
    g.fillStyle = tone(look.ink)
    g.fillRect(w * 0.22, TOP + SIGN_H / 2 - 0.4, w * 0.56, 0.8)
  } else if (shop.word !== undefined) {
    const cross = shop.span.row.kind === 'pharmacy' ? CROSS_SHIFT : 0

    if (cross > 0) {
      g.fillStyle = tone(look.ink)
      g.fillRect(1.1, TOP + SIGN_H / 2 - 1, 0.5, 2)
      g.fillRect(0.35, TOP + SIGN_H / 2 - 0.25, 2, 0.5)
    }

    const maxW = w - WORD.inset - cross
    const { lines, size } = wordLayoutOf(g, shop.word, maxW)
    const firstY = TOP + SIGN_H / 2 + WORD.rise - ((lines.length - 1) * WORD.lineStep) / 2

    lines.forEach((line, index) => {
      paintLabel(g, line, {
        x: w / 2 + cross,
        y: firstY + index * WORD.lineStep,
        size,
        colour: tone(look.ink),
        maxW,
      })
    })
  }

  if (front.isLit) {
    paintNeon(front)
  }
}

// The word on one line, or on two where the break letters it larger.
function wordLayoutOf(
  g: CanvasRenderingContext2D,
  word: string,
  maxW: number
): { readonly lines: readonly string[]; readonly size: number } {
  const oneLine = Math.min(WORD.size, fitSize(g, [word], maxW))
  const halves = halvesOf(word)

  if (halves === undefined) {
    return { lines: [word], size: oneLine }
  }

  const twoLines = Math.min(WORD.twoLineSize, fitSize(g, halves, maxW))

  return twoLines > oneLine ? { lines: halves, size: twoLines } : { lines: [word], size: oneLine }
}

// The size at which the widest of `lines` fills `maxW`.
function fitSize(g: CanvasRenderingContext2D, lines: readonly string[], maxW: number): number {
  const widest = Math.max(...lines.map((line) => measureLabel(g, line, MEASURE_PX)))

  return widest > 0 ? (maxW / widest) * MEASURE_PX : WORD.size
}

// The word broken at the space that leaves its two halves closest in length; none for one word.
function halvesOf(word: string): readonly [string, string] | undefined {
  const parts = word.split(WORD_SEPARATOR)
  let best: readonly [string, string] | undefined

  for (let at = 1; at < parts.length; at++) {
    const pair = [
      parts.slice(0, at).join(WORD_SEPARATOR),
      parts.slice(at).join(WORD_SEPARATOR),
    ] as const
    const isCloser =
      best === undefined ||
      Math.abs(pair[0].length - pair[1].length) < Math.abs(best[0].length - best[1].length)

    best = isCloser ? pair : best
  }

  return best
}

// An open sign shows its colours, lit or not; a closed one dims further.
function signTone(front: ShopFront): (hex: string) => string {
  const { shop, isLit } = front
  const share = shop.isOpen ? SHUT_NIGHT.open : SHUT_NIGHT.closed

  return (hex) => (isLit ? hex : mixTone(hex, NIGHT_TONE, share + shop.dark * 0.5))
}

// A glow on the pavement under the sign, then the kind's tube round it: neon for a café or bar
// front, the green cross of a pharmacy, a strip on a bank.
function paintNeon(front: ShopFront): void {
  const { g, w, shop } = front
  const colour = NEON[shop.span.row.kind]

  if (colour === undefined) {
    return
  }

  const cy = TOP + SIGN_H / 2
  const glow = g.createRadialGradient(w / 2, cy, 0, w / 2, cy, Math.max(w, 8) * 0.8)

  glow.addColorStop(0, `${colour}55`)
  glow.addColorStop(1, `${colour}00`)
  g.fillStyle = glow
  g.fillRect(-2, TOP - 5, w + 4, SIGN_H + 10)
  g.fillStyle = colour

  switch (shop.span.row.kind) {
    case 'cafe':
    case 'bar':
      g.strokeStyle = colour
      g.lineWidth = 0.35
      g.lineJoin = 'round'
      g.strokeRect(0.7, TOP + 0.5, w - 1.4, SIGN_H - 1)

      if (shop.detail > 0) {
        g.globalAlpha = 0.4
        g.lineWidth = 1
        g.strokeRect(0.7, TOP + 0.5, w - 1.4, SIGN_H - 1)
        g.globalAlpha = 1
      }
      return
    case 'pharmacy':
      g.fillRect(0.9, cy - 1.15, 0.8, 2.3)
      g.fillRect(0.15, cy - 0.4, 2.3, 0.8)
      return
    case 'bank':
      g.globalAlpha = 0.8
      g.fillRect(1, TOP + SIGN_H - 0.7, w - 2, 0.35)
      g.globalAlpha = 1
      return
    default:
      return
  }
}

// An open front: awning stripes, the shop window with what is on show, the door.
function paintOpenFront(front: ShopFront): void {
  const { g, w, look, shop } = front
  const kind = shop.span.row.kind
  const windowH = -WINDOW_TOP

  if (kind !== 'bank') {
    const stripes = Math.max(2, Math.round(w / 2.4))

    for (let i = 0; i < stripes; i++) {
      g.fillStyle = front.tone(look.awning[i % 2] ?? look.awning[0], 0.5)
      g.fillRect((i * w) / stripes, TOP + SIGN_H, w / stripes + 0.05, AWNING_H)
    }
  }

  g.fillStyle = front.isLit
    ? WINDOW.lit
    : mixTone(WINDOW.glass, WINDOW.glassNight, 0.25 + shop.dark * 0.4)
  g.fillRect(1, WINDOW_TOP, w - 2, windowH)

  if (shop.detail > 0) {
    paintInterior(front, windowH)
  }

  paintDoor(front, windowH)
}

function paintInterior(front: ShopFront, windowH: number): void {
  const { g, w, look } = front
  const shelf = front.tone(SHELF, 0.5)

  g.fillStyle = shelf

  switch (front.shop.span.row.kind) {
    case 'store':
      for (let row = 0; row < 2; row++) {
        g.fillStyle = shelf
        g.fillRect(1.4, WINDOW_TOP + 1.6 + row * 2.2, w / 2 - 2.2, 0.35)
        g.fillRect(w / 2 + 1, WINDOW_TOP + 1.6 + row * 2.2, w / 2 - 2.4, 0.35)

        for (let item = 0; item < Math.max(2, Math.floor(w / 5)); item++) {
          g.fillStyle = front.tone(GOODS[(item + row * 2) % GOODS.length] ?? GOODS[0], 0.5)
          g.fillRect(1.8 + item * 1.4, WINDOW_TOP + 0.9 + row * 2.2, 0.9, 0.7)
          g.fillRect(w / 2 + 1.4 + item * 1.4, WINDOW_TOP + 0.9 + row * 2.2, 0.9, 0.7)
        }
      }
      return
    case 'bank':
      g.fillStyle = front.tone('#2A2F3F', 0.5)
      g.fillRect(w - 4.2, WINDOW_TOP + 0.8, 3, windowH - 1.6)
      g.fillStyle = front.isLit ? '#7DE3A6' : front.tone('#3F6F55', 0.5)
      g.fillRect(w - 3.7, WINDOW_TOP + 1.4, 2, 1.2)
      g.fillStyle = front.tone('#8A93A6', 0.5)
      g.fillRect(1.4, WINDOW_TOP + windowH - 1.2, w - 6.4, 0.5)
      return
    case 'pharmacy':
      g.fillStyle = front.tone('#E9EEF0', 0.5)
      g.fillRect(1.4, WINDOW_TOP + 0.9, w - 2.8, 0.45)
      g.fillRect(1.4, WINDOW_TOP + 2.9, w - 2.8, 0.45)
      g.fillStyle = front.tone(look.band, 0.5)
      g.fillRect(2, WINDOW_TOP + 1.6, w * 0.3, 0.35)
      return
    default:
      g.fillStyle = front.tone('#2A2F3F', 0.5)
      g.fillRect(1.8, WINDOW_TOP + 0.8, Math.max(2, w / 2 - 3.2), 1.7)
      g.fillStyle = front.tone(look.awning[0], 0.5)
      g.fillRect(2.3, WINDOW_TOP + 1.2, Math.max(1, w / 2 - 4.2), 0.35)
      g.fillStyle = front.tone('#8A6B4E', 0.5)
      g.fillRect(1, WINDOW_TOP + windowH - 1.6, w - 2, 1.6)
  }
}

// The door, with its frame; a day-and-night shop says so from the closest detail.
function paintDoor(front: ShopFront, windowH: number): void {
  const { g, w, shop } = front
  const doorW = Math.min(DOOR_W.max, Math.max(DOOR_W.min, w * DOOR_W.share))
  const left = w / 2 - doorW / 2

  g.fillStyle = front.isLit ? WINDOW.doorLit : mixTone(WINDOW.door, NIGHT_TONE, shop.dark * 0.5)
  g.fillRect(left, WINDOW_TOP, doorW, windowH)
  g.fillStyle = front.tone(WINDOW.frame, 0.5)
  g.fillRect(left - 0.2, WINDOW_TOP, 0.4, windowH)
  g.fillRect(left + doorW - 0.2, WINDOW_TOP, 0.4, windowH)
  g.fillRect(left - 0.2, WINDOW_TOP, doorW + 0.4, 0.4)

  if (shop.detail === 2 && isAllDay(shop.span.row) && w >= NOTE.minWidth) {
    paintLabel(g, tr('ui.office.street.open247'), {
      x: w / 2,
      y: WINDOW_TOP + windowH * 0.45,
      size: 1.5,
      colour: OPEN247,
      maxW: doorW,
    })
  }
}

// The roller shutter over the shop window, `drop` of the way down; a closed shop from the closest
// detail pins up a note with its word and the hour it opens.
function paintShutter(front: ShopFront, drop: number): void {
  const { g, w, shop } = front
  const top = TOP + SIGN_H
  const height = (SHOP_RISE - SIGN_H + 2) * drop

  g.fillStyle = front.tone(SHUTTER.slat, 0.5)
  g.fillRect(0, top, w, height)
  g.fillStyle = SHUTTER.line

  for (let y = top + 1.4; y < top + height; y += SHUTTER.lineGap) {
    g.fillRect(0, y, w, 0.35)
  }

  if (drop < 1) {
    g.fillStyle = front.tone(SHUTTER.edge, 0.5)
    g.fillRect(0, top + height - 0.8, w, 0.8)
    g.fillStyle = SHUTTER.handle
    g.fillRect(w / 2 - 1, top + height - 0.5, 2, 0.35)
    return
  }

  if (shop.detail > 0) {
    g.fillStyle = 'rgba(0,0,0,.28)'
    g.fillRect(0, top, w, 1.1)
  }

  if (shop.detail === 2 && shop.word !== undefined && w >= NOTE.minWidth) {
    paintNote(front)
  }
}

function paintNote(front: ShopFront): void {
  const { g, w, shop } = front
  const noteW = Math.min(NOTE.maxWidth, w - 1.6)
  const opens = formatHourOfDay(shop.span.row.hours[0] / MINUTES_PER_HOUR)
  const at = { x: w / 2, size: 1.3, colour: NOTE.ink, maxW: noteW - 0.6 }

  g.fillStyle = front.tone(NOTE.paper, 0.5)
  g.fillRect(w / 2 - noteW / 2, WINDOW_TOP + 1.6, noteW, 3.3)
  paintLabel(g, tr('ui.office.street.closed'), { ...at, y: WINDOW_TOP + 2.5 })
  paintLabel(g, tr('ui.office.street.opensAt', { time: opens }), { ...at, y: WINDOW_TOP + 4 })
}
