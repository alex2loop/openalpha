import type { MessageKey } from '@/i18n'
import type { ScreenLine } from '@/web/scene/overlay-types'
import type { RoomId } from '@/web/scene/types'
import { clip, FONT, MONO } from '@/web/scene/sprites/face-text'
import { tr } from '@/web/text/tr'

// The mockup's monitor screen: a 160 by 100 logical window drawn at twice that, with a menu bar,
// a title bar with three dots, typed lines and a status bar.
export const SCREEN = Object.freeze({
  w: 160,
  h: 100,
  res: 2,
  bar: 4,
  menu: 10,
  title: 12,
  status: 10,
})
// The terminal's rows, as the mockup sets them: 15 px mono lines 17 apart, as many as fit between
// the title bar and the status bar.
const LINE = Object.freeze({ px: 15, lead: 17, rows: 3, pad: 4 })
// Under this many CSS px a line's text is drawn as a bar.
const TEXT_MIN_PX = 6
// A bar is as wide as its characters at this share of a letter, at least `min`, 6 tall.
const BAR = Object.freeze({ perChar: 0.8, min: 8, h: 6 })
// The cursor's block, in logical px: a letter wide in text, this size beside a bar.
const CURSOR_BAR = Object.freeze({ w: 5, h: 10, gap: 2 })
const CURSOR_TEXT_GAP = 1
const CURSOR_TEXT_TRIM = 3
const TONE = Object.freeze({
  rim: '#262B3D',
  edge: '#3A4260',
  body: '#141A36',
  menu: '#0B0F22',
  title: '#2B3566',
  menuInk: '#E9ECF8',
  clock: '#C9D3F0',
  titleInk: '#B9C4EE',
  status: '#8FA0C8',
})
/** The cursor's colour. */
export const CURSOR_TONE = '#D7E0F5'
// A line's colour by what it is: the command, a step done, the step under way.
const LINE_TONE: Readonly<Record<ScreenLine['kind'], string>> = Object.freeze({
  command: '#8DB4FF',
  done: '#6FE3D6',
  step: '#F2C46C',
})
const DOTS = ['#FF6259', '#F2C46C', '#6FE3D6'] as const
const APP_KEYS: Readonly<Partial<Record<RoomId, MessageKey>>> = Object.freeze({
  lib: 'ui.office.room.lib',
  meet: 'ui.office.room.meet',
  assist: 'ui.office.room.assist',
  desk: 'ui.office.room.desk',
})

/** The cursor's block on the screen, in logical px. */
export interface CursorRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** Whether a monitor `w` world px wide at `scale` CSS px per world px is too small for its text:
 *  the mockup's test, on the size the line's text would take on screen. */
export function isMonitorTiny(w: number, scale: number): boolean {
  return (LINE.px * w * scale) / SCREEN.w < TEXT_MIN_PX
}

/** Draws the screen: the chrome, then the run's last rows with the newest typed to `typed`
 *  characters. Tiny, it keeps the dots and sets each line as a bar. Returns where the cursor goes,
 *  after the newest line; the cursor is not drawn, so it can blink without a repaint. */
export function drawScreen(
  canvas: HTMLCanvasElement,
  at: {
    readonly room: RoomId | undefined
    readonly lines: readonly ScreenLine[]
    readonly typed: number
    readonly clock: string
    readonly name: string | undefined
    readonly title: string
    readonly isTiny: boolean
  }
): CursorRect | undefined {
  const c = canvas.getContext('2d')

  if (c === null) {
    return undefined
  }

  const { w, h, bar, menu, title, status } = SCREEN
  const inner = w - bar * 2

  c.setTransform(SCREEN.res, 0, 0, SCREEN.res, 0, 0)
  c.fillStyle = TONE.rim
  c.fillRect(0, 0, w, h)
  c.fillStyle = TONE.edge
  c.fillRect(1.5, 1.5, w - 3, h - 3)
  c.fillStyle = TONE.body
  c.fillRect(bar, bar, inner, h - bar * 2)
  c.fillStyle = TONE.menu
  c.fillRect(bar, bar, inner, menu)
  c.fillRect(bar, h - bar - status, inner, status)
  c.fillStyle = TONE.title
  c.fillRect(bar, bar + menu, inner, title)
  drawChrome(c, at)

  return drawLines(c, at)
}

function drawChrome(
  c: CanvasRenderingContext2D,
  at: {
    readonly room: RoomId | undefined
    readonly title: string
    readonly clock: string
    readonly isTiny: boolean
  }
): void {
  const { w, bar, menu, title } = SCREEN
  const menuY = bar + menu / 2 + 0.3
  const titleY = bar + menu + title / 2 + 0.3
  const appKey = at.room === undefined ? undefined : APP_KEYS[at.room]

  for (const [i, tone] of DOTS.entries()) {
    c.fillStyle = tone
    c.beginPath()
    c.arc(bar + 6 + i * 6, titleY, 1.7, 0, Math.PI * 2)
    c.fill()
  }

  if (at.isTiny) {
    return
  }

  c.textBaseline = 'middle'
  c.font = `700 7px ${FONT}`
  c.textAlign = 'left'
  c.fillStyle = TONE.menuInk
  c.fillText(appKey === undefined ? '' : tr(appKey), bar + 4, menuY, w * 0.6)
  c.textAlign = 'right'
  c.font = `600 7px ${FONT}`
  c.fillStyle = TONE.clock
  c.fillText(at.clock, w - bar - 4, menuY)
  c.textAlign = 'left'
  c.fillStyle = TONE.titleInk
  c.fillText(at.title, bar + 27, titleY, w - bar * 2 - 30)
}

// The terminal's last rows, the run's name in the status bar, and where the cursor goes.
function drawLines(
  c: CanvasRenderingContext2D,
  at: {
    readonly lines: readonly ScreenLine[]
    readonly typed: number
    readonly name: string | undefined
    readonly isTiny: boolean
  }
): CursorRect | undefined {
  const { w, h, bar, menu, title, status } = SCREEN
  const rows = at.lines.slice(-LINE.rows)
  const top = bar + menu + title + 3 + LINE.lead / 2
  const left = bar + LINE.pad
  const maxW = w - left * 2
  let endX = left

  c.textBaseline = 'middle'
  c.font = `500 ${LINE.px}px ${MONO}`
  c.textAlign = 'left'

  const letterW = c.measureText('M').width

  for (const [i, line] of rows.entries()) {
    const text = i === rows.length - 1 ? line.text.slice(0, at.typed) : line.text
    const y = top + i * LINE.lead

    c.fillStyle = LINE_TONE[line.kind]
    endX = at.isTiny
      ? drawBar(c, text, { x: left, y, maxW, letterW })
      : drawText(c, text, { x: left, y, maxW })
  }

  if (!at.isTiny) {
    c.font = `500 6.5px ${FONT}`
    c.fillStyle = TONE.status
    c.fillText(at.name ?? '', bar + 4, h - bar - status / 2 + 0.3, w * 0.55)
  }

  return rows.length === 0
    ? undefined
    : cursorAt({ endX, y: top + (rows.length - 1) * LINE.lead, letterW, isTiny: at.isTiny })
}

// The text, cut to fit; returns where it ends.
function drawText(
  c: CanvasRenderingContext2D,
  text: string,
  at: { readonly x: number; readonly y: number; readonly maxW: number }
): number {
  const fitted = clip(c, text, at.maxW)

  c.fillText(fitted, at.x, at.y)

  return at.x + c.measureText(fitted).width
}

// The text as a bar, as wide as its letters at the mockup's share; returns where it ends.
function drawBar(
  c: CanvasRenderingContext2D,
  text: string,
  at: { readonly x: number; readonly y: number; readonly maxW: number; readonly letterW: number }
): number {
  if (text === '') {
    return at.x
  }

  const width = Math.min(at.maxW, Math.max(BAR.min, text.length * at.letterW * BAR.perChar))

  c.fillRect(at.x, at.y - BAR.h / 2, width, BAR.h)

  return at.x + width
}

function cursorAt(at: {
  readonly endX: number
  readonly y: number
  readonly letterW: number
  readonly isTiny: boolean
}): CursorRect {
  const { w, bar } = SCREEN
  const right = w - bar - LINE.pad * 2

  if (at.isTiny) {
    const { w: cw, h: ch, gap } = CURSOR_BAR

    return { x: Math.min(at.endX + gap, right), y: at.y - ch / 2, w: cw, h: ch }
  }

  return {
    x: Math.min(at.endX + CURSOR_TEXT_GAP, right),
    y: at.y - LINE.lead / 2 + CURSOR_TEXT_TRIM,
    w: at.letterW,
    h: LINE.lead - CURSOR_TEXT_TRIM * 2,
  }
}
