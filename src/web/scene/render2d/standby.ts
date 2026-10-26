import type { PaintScene } from '@/web/scene/render2d/wall-props'
import { fill } from '@/web/scene/render2d/building'
import { DEVICE_TONES, moveToneOf } from '@/web/scene/sprites/palette'
import { paintPixelText, pixelTextWidth } from '@/web/scene/sprites/pixel-font'
import { MINUTES_PER_HOUR } from '@/web/text/time-units'

/** What a StandBy phone propped on a desk shows: drifting colour, a small clock and the index's
 *  move, or the time large. */
type StandbyView = 'flow' | 'widgets' | 'clocks'

const STANDBY_PHASES = 6
/** The drifting colour steps once this often on the ambient clock. */
export const STANDBY_STEP_MS = 1200
// The screen is this many world px; its digits are 3x5 dots, a dot some whole device px.
const SCREEN_W = 10
const SCREEN_H = 5
const GLYPH_H = 5
const ROW_PITCH = 6
const MAX_DOT = 3
// Digits under this many CSS px tall cannot be read, and the screen keeps its marks.
const LEGIBLE_PX = 4.5
const CLOCK_DIGITS = 2
const FLOW_TEXT = 'rgba(255,255,255,.9)'
const PERCENT = '%'

/** A phone propped open on its stand: the lower half flat on the desk, the upper half the lit
 *  screen showing `view`; red once the office is quiet, then dimmed. */
export function paintStandby(
  g: CanvasRenderingContext2D,
  at: { readonly x: number; readonly y: number; readonly view: StandbyView },
  scene: PaintScene
): void {
  const { x, y, view } = at
  const isRed = scene.life.isQuiet
  const tones: StandbyTones = isRed ? DEVICE_TONES.standbyNight : DEVICE_TONES.standbyDay

  fill(g, [x, y + 7, 12, 2], DEVICE_TONES.titanium)
  fill(g, [x + 1, y + 7, 10, 1], DEVICE_TONES.standbyGlass)
  fill(g, [x, y, 12, 7], DEVICE_TONES.titanium)
  fill(g, [x, y + 6, 12, 1], DEVICE_TONES.titaniumEdge)
  fill(g, [x + 1, y + 1, 10, 5], tones.screen)

  const text = standbyTextOf(view, scene)

  if (view === 'flow') {
    paintFlow(g, { x, y, phase: flowPhaseOf(scene), tones })
  } else if (text === undefined && view === 'widgets') {
    paintWidgets(g, { x, y, tones, scene })
  } else if (text === undefined) {
    paintBigClock(g, { x, y, tones })
  }

  if (text !== undefined) {
    paintStandbyText(g, { x, y, view, text, tones, scene })
  }

  if (isRed) {
    fill(g, [x + 1, y + 1, 10, 5], DEVICE_TONES.quietVeil)
  }
}

/** A StandBy screen's tones, by day or red at night. */
interface StandbyTones {
  readonly screen: string
  readonly flowGround: string
  readonly flow: readonly string[]
  readonly well: string
  readonly ink: string
  readonly colon: string
  readonly hole: string
}

function paintFlow(
  g: CanvasRenderingContext2D,
  at: {
    readonly x: number
    readonly y: number
    readonly phase: number
    readonly tones: StandbyTones
  }
): void {
  const { x, y, phase, tones } = at

  fill(g, [x + 1, y + 1, 10, 5], tones.flowGround)

  for (const [i, tone] of tones.flow.entries()) {
    fill(g, [x + 1 + ((phase + i * 3) % 8), y + 1 + ((i + phase) % 4), 3, 2], tone)
  }
}

// A small analogue clock on the left, the index's move as a bar on the right.
function paintWidgets(
  g: CanvasRenderingContext2D,
  at: {
    readonly x: number
    readonly y: number
    readonly tones: StandbyTones
    readonly scene: PaintScene
  }
): void {
  const { x, y, tones, scene } = at
  const minutes = scene.minuteOfDay
  const angle = (((minutes / 60) % 12) * Math.PI) / 6
  const move = scene.indexMove

  fill(g, [x + 2, y + 2, 3, 3], tones.well)
  fill(
    g,
    [x + 3 + Math.round(Math.sin(angle)), y + 3 - Math.round(Math.cos(angle)), 1, 1],
    tones.ink
  )
  fill(g, [x + 6, y + 2, 4, 3], tones.well)
  const bar = move === 'flat' ? DEVICE_TONES.flat : moveToneOf(move)

  fill(g, [x + 7, y + 3, 2, 1], scene.life.isQuiet ? tones.ink : bar)
}

function paintBigClock(
  g: CanvasRenderingContext2D,
  at: { readonly x: number; readonly y: number; readonly tones: StandbyTones }
): void {
  const { x, y, tones } = at

  fill(g, [x + 2, y + 2, 2, 3], tones.ink)
  fill(g, [x + 5, y + 2, 1, 1], tones.colon)
  fill(g, [x + 5, y + 4, 1, 1], tones.colon)
  fill(g, [x + 7, y + 2, 3, 3], tones.ink)
  fill(g, [x + 3, y + 3, 1, 1], tones.hole)
  fill(g, [x + 8, y + 3, 1, 1], tones.hole)
}

// The drifting colour's step: on the ambient clock while it runs, else the page minute's.
function flowPhaseOf(scene: PaintScene): number {
  const step = scene.fx === undefined ? scene.minuteOfDay : scene.fx.ms / STANDBY_STEP_MS

  return Math.floor(step) % STANDBY_PHASES
}

interface StandbyText {
  /** Device px a dot, and the screen's device px per world px. */
  readonly dot: number
  readonly perPx: number
  readonly time: string
}

// The mockup's StandBy digits: the largest whole-device-px dot that fits the time across the
// screen (and two rows for the widgets), or none while it would read under `LEGIBLE_PX`.
function standbyTextOf(view: StandbyView, scene: PaintScene): StandbyText | undefined {
  const perPx = scene.stretch
  let dot = Math.min(
    Math.floor((SCREEN_W * perPx - 2) / 19),
    Math.floor((SCREEN_H * perPx - 2) / GLYPH_H),
    MAX_DOT
  )

  while (view === 'widgets' && dot > 1 && rowsOf(perPx, dot) < 2) {
    dot--
  }

  const cssPx = (GLYPH_H * dot * scene.scale) / perPx

  return dot < 1 || cssPx < LEGIBLE_PX
    ? undefined
    : { dot, perPx, time: clockOf(scene.minuteOfDay) }
}

function rowsOf(perPx: number, dot: number): number {
  const pad = dot > 1 ? 2 : 1

  return Math.floor((SCREEN_H * perPx - pad + dot) / (ROW_PITCH * dot))
}

function clockOf(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / MINUTES_PER_HOUR)
  const minutes = Math.floor(minuteOfDay % MINUTES_PER_HOUR)

  return `${String(hours).padStart(CLOCK_DIGITS, '0')}:${String(minutes).padStart(CLOCK_DIGITS, '0')}`
}

// The digits in device px over the screen at (x + 1, y + 1): the time centred on the clock, the
// time over the index's move on the widgets, the time low on the drifting colour.
function paintStandbyText(
  g: CanvasRenderingContext2D,
  at: {
    readonly x: number
    readonly y: number
    readonly view: StandbyView
    readonly text: StandbyText
    readonly tones: StandbyTones
    readonly scene: PaintScene
  }
): void {
  const { view, text, tones, scene } = at
  const { dot, perPx, time } = text
  const screenW = SCREEN_W * perPx
  const screenH = SCREEN_H * perPx
  const pad = dot > 1 ? 2 : 1
  const timeW = pixelTextWidth(time) * dot
  const print = (line: string, px: { x: number; y: number }, color: string): void =>
    paintPixelText(g, line, {
      x: at.x + 1 + px.x / perPx,
      y: at.y + 1 + px.y / perPx,
      color,
      dot: dot / perPx,
    })

  if (view === 'clocks') {
    print(
      time,
      { x: Math.floor((screenW - timeW) / 2), y: Math.floor((screenH - GLYPH_H * dot) / 2) },
      tones.ink
    )
  } else if (view === 'flow') {
    const color = scene.life.isQuiet ? tones.ink : FLOW_TEXT

    print(time, { x: Math.floor((screenW - timeW) / 2), y: screenH - GLYPH_H * dot - pad }, color)
  } else {
    const columns = Math.floor((screenW - pad * 2) / (4 * dot))
    const move = fitMove(scene.indexMoveText, columns)

    print(time, { x: pad, y: pad }, tones.ink)

    if (move !== undefined && rowsOf(perPx, dot) >= 2) {
      const tone = scene.indexMove === 'flat' ? DEVICE_TONES.flat : moveToneOf(scene.indexMove)

      print(move, { x: pad, y: pad + ROW_PITCH * dot }, scene.life.isQuiet ? tones.ink : tone)
    }
  }
}

// The move as wide as the columns allow: whole, without the percent sign, without spaces, both.
function fitMove(move: string | undefined, columns: number): string | undefined {
  if (move === undefined) {
    return undefined
  }

  const bare = move.replace(PERCENT, '')
  const tries = [move, bare, move.replaceAll(' ', ''), bare.replaceAll(' ', '')]

  return (
    tries.find((one) => [...one].length <= columns) ?? tries[tries.length - 1]?.slice(0, columns)
  )
}
