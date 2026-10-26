import type { AgendaModel } from '@/web/scene/data/agenda'
import type { AlertStrip, StripTone } from '@/web/scene/data/alert-strip'
import type { AmbientFx } from '@/web/scene/render2d/ambient-fx'
import type { DetailLevel } from '@/web/scene/sim/life/animal-model'
import type { BoardNotes, ScreenCache } from '@/web/scene/sprites/screens'
import type { LifeView, LiftView, RoomId } from '@/web/scene/types'
import type { PropDef, PropKind } from '@/web/scene/world/props'
import { castShadow, fill, framed, INK } from '@/web/scene/render2d/building'
import { paintWallMonitor } from '@/web/scene/render2d/desk-devices'
import { FONT } from '@/web/scene/sprites/face-text'
import { faceKindOf, paintCork } from '@/web/scene/sprites/screens'
import { createRng } from '@/web/scene/world/rng'
import { MINUTES_PER_HOUR } from '@/web/text/time-units'

const SWITCH_ON = '#FFB340'
const SWITCH_OFF = '#8E8497'
const ART = [
  ['#D9B98F', '#BFE0F2', '#F6D69B', '#B9D9B5'],
  ['#C9B9D9', '#F2C9C2', '#BFD3EE', '#F6E3A8'],
  ['#E8C9A0', '#DCD3EE', '#F2C9D8', '#C3DCEE'],
] as const
const MARKER_TONES = ['#7C93D6', '#A596D9', '#6F7388'] as const
const HOURS_ON_DIAL = 12
const HOUR_HAND_PX = 3
const MINUTE_HAND_PX = 5
const CLOCK_TICK = '#8E8497'
const STRIP_VARIANT = 4
const AIR_CON_RIBBONS = 3
const RIBBON_SWAY_MS = 420
const RIBBON_PHASE = 1.7
const RIBBON_SWAY_PX = 1.4
const AIR_CON_TONES = Object.freeze({
  body: '#EEF0F4',
  vent: '#B9BEC9',
  line: '#CBD0DA',
  ribbon: '#F2C9C2',
})
const STORE_MONITOR_VARIANT = 0
// The lobby's lower agenda board stands on two legs.
const STANDING_BOARD_VARIANT = 2
const BOARD_LEG_PX = 12
const STRIP_LEG_PX = 26
const STRIP_GROUND = '#0E1020'
const STRIP_SHINE = 'rgba(255,255,255,.08)'
const STRIP_PX_PER_CHAR = 1.2
const STRIP_GAP_PX = 4
const STRIP_SCROLL_PX_PER_MS = 0.012
const STRIP_GAP_TONE = '#5B6A99'
const STRIP_TONES: Readonly<Record<StripTone, string>> = Object.freeze({
  problem: '#FF8A8E',
  caution: '#FFD98A',
  plain: '#FFE9B0',
})
const SQUIGGLE_INSET = 0.07
const SQUIGGLE_WIDTH = 0.022
const SQUIGGLE_STEP = 0.05
const SQUIGGLE_JITTER = 0.06
const CAPTION_INK = '#3A3F58'
const CAPTION_STEP = '#5E6BB0'
// A board's subject and its step, as its line joins them.
const CAPTION_SPLIT = ': '
const STEP_NUMBER = /(\d+)\/\d+/
// The title is about this share of the board's height; under this many CSS px only the number shows.
const CAPTION_SHARE = 0.115
const MIN_CAPTION_PX = 9

/** What the props show this frame: the lamps on, the clock, the zoom, and what the boards read. */
export interface PaintScene {
  readonly lit: ReadonlySet<RoomId>
  readonly isAnyLit: boolean
  readonly minuteOfDay: number
  readonly scale: number
  readonly isPrinting: boolean
  readonly notes: BoardNotes
  readonly strip: AlertStrip
  readonly agenda: AgendaModel
  readonly screens: ScreenCache
  readonly life: LifeView
  readonly detail: DetailLevel
  readonly isRaining: boolean
  readonly lift: LiftView
  /** Which way the home index moved in its session: the StandBy widgets' bar. */
  readonly indexMove: 'up' | 'down' | 'flat'
  /** An approval waits for you: the amber light on your tray. */
  readonly isAwaitingYou: boolean
  /** Today's day of the month, as your desk calendar prints it. */
  readonly dayOfMonth: string
  /** The rack's lights, a data source each, and whether the store refreshes now. */
  readonly sources: readonly ('fresh' | 'stale')[]
  readonly isRefreshing: boolean
  /** The ambient effects on their one clock; absent when every effect draws its still frame. */
  readonly fx: AmbientFx | undefined
  /** How far the store's refresh has come, 0 to 1; absent while it does not count its prices. */
  readonly refreshShare?: number
  /** Each lobby wall clock's minute of its own zone's day, by the clock's `variant`. */
  readonly wallClocks: readonly number[]
  /** What each room's whiteboard says while a run counts its steps there. */
  readonly captions: Partial<Record<RoomId, string>>
}

export type Painter = (g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene) => void

/** The painters of what hangs on the walls: boards, screens, clocks, frames, the switch. */
export const WALL_PAINTERS = Object.freeze({
  whiteboard: paintWhiteboard,
  'results-board': paintResults,
  'wall-screen': paintWallScreen,
  clock: paintClock,
  frame: paintFrame,
  'light-switch': paintSwitch,
  'air-con': paintAirCon,
} satisfies Partial<Record<PropKind, Painter>>)

function paintWhiteboard(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y, w, h } = prop.draw

  castShadow(g, [x + 2, y + h + 8, w, 3])
  framed(g, [x, y, w, h], '#FAFAFC')
  fill(g, [x, y + h - 2, w, 2], '#C9CCD6')
  fill(g, [x + 3, y + h, 2, 9], INK)
  fill(g, [x + w - 5, y + h, 2, 9], INK)

  paintSquiggles(g, prop)

  const caption = scene.captions[prop.room]

  if (caption !== undefined) {
    paintCaption(g, {
      rect: prop.draw,
      caption,
      isTiny: h * CAPTION_SHARE * scene.scale < MIN_CAPTION_PX,
    })
  }
}

// The three marker squiggles under the title, the same for a board every frame.
function paintSquiggles(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w, h } = prop.draw
  const rng = createRng(prop.variant ?? 0)
  const left = w * SQUIGGLE_INSET

  g.lineWidth = h * SQUIGGLE_WIDTH
  g.lineCap = 'round'
  g.lineJoin = 'round'

  for (const [i, tone] of MARKER_TONES.entries()) {
    const row = y + h * (0.6 + i * 0.12)
    const length = w * (0.45 + rng.next() * 0.4)

    g.strokeStyle = tone
    g.beginPath()
    g.moveTo(x + left, row)

    for (let step = left; step < left + length; step += w * SQUIGGLE_STEP) {
      g.lineTo(x + step, row + (rng.next() - 0.5) * h * SQUIGGLE_JITTER)
    }

    g.stroke()
  }

  g.lineWidth = 1
}

// The board's title in marker: the subject, then its step; far off, only the step's number.
function paintCaption(
  g: CanvasRenderingContext2D,
  at: { readonly rect: PropDef['draw']; readonly caption: string; readonly isTiny: boolean }
): void {
  const { x, y, w, h } = at.rect
  const [head, step] = at.caption.split(CAPTION_SPLIT)

  g.fillStyle = CAPTION_INK

  if (at.isTiny) {
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `700 ${h * 0.5}px ${FONT}`
    g.fillText(STEP_NUMBER.exec(at.caption)?.[1] ?? at.caption.slice(0, 2), x + w / 2, y + h * 0.34)
    return
  }

  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  g.font = `700 ${h * 0.2}px ${FONT}`
  g.fillText(step === undefined ? at.caption : (head ?? ''), x + w * 0.07, y + h * 0.28, w * 0.86)

  if (step !== undefined) {
    g.font = `600 ${h * 0.15}px ${FONT}`
    g.fillStyle = CAPTION_STEP
    g.fillText(step, x + w * 0.07, y + h * 0.48, w * 0.86)
  }
}

function paintResults(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  paintCork(g, prop.draw, scene.notes.calls)
}

function paintWallScreen(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y, w, h } = prop.draw

  if (prop.variant === STORE_MONITOR_VARIANT) {
    paintWallMonitor(g, prop.draw, scene)
    return
  }

  fill(g, [x - 1, y - 1, w + 2, h + 2], INK)

  const kind = faceKindOf(prop)

  if (kind === 'agenda' || kind === 'tape') {
    const face = scene.screens.faceOf(prop, {
      model: scene.agenda,
      scale: scene.scale,
      notes: scene.notes,
    })

    if (face !== undefined) {
      g.drawImage(face.canvas, x, y, w, h)
    }

    if (prop.variant === STANDING_BOARD_VARIANT) {
      fill(g, [x + 4, y + h, 2, BOARD_LEG_PX], INK)
      fill(g, [x + w - 4, y + h, 2, BOARD_LEG_PX], INK)
    }

    return
  }

  if (prop.variant === STRIP_VARIANT) {
    paintStrip(g, prop.draw, { strip: scene.strip, fx: scene.fx })
    return
  }

  fill(g, [x, y, w, h], '#171A2B')
}

// The LED strip on its two legs over the alert desk: a bar a word of each headline in its tone,
// a gap between headlines, held still and repeated along the strip.
function paintStrip(
  g: CanvasRenderingContext2D,
  rect: PropDef['draw'],
  at: { readonly strip: AlertStrip; readonly fx: AmbientFx | undefined }
): void {
  const { x, y, w, h } = rect
  const { strip } = at
  const words = strip.lines.flatMap((line) => [
    ...line.title
      .split(' ')
      .filter((word) => word !== '')
      .map(
        (word) =>
          [
            Math.max(2, Math.round(word.length * STRIP_PX_PER_CHAR)),
            STRIP_TONES[line.tone],
          ] as const
      ),
    [STRIP_GAP_PX, STRIP_GAP_TONE] as const,
  ])
  const total = words.reduce((sum, [width]) => sum + width + 1, 0)

  fill(g, [x + 3, y + h, 2, STRIP_LEG_PX], INK)
  fill(g, [x + w - 5, y + h, 2, STRIP_LEG_PX], INK)
  fill(g, [x, y, w, h], STRIP_GROUND)
  g.save()
  g.beginPath()
  g.rect(x, y, w, h)
  g.clip()

  // While a headline is new the words scroll on the ambient clock; otherwise they hold still.
  const offset =
    at.fx?.strip === true && total > 0 ? Math.floor(at.fx.ms * STRIP_SCROLL_PX_PER_MS) % total : 0

  for (let left = x - offset; total > 0 && left < x + w; left += total) {
    let wordX = left

    for (const [width, tone] of words) {
      fill(g, [wordX, y + 3, width, 2], tone)
      wordX += width + 1
    }
  }

  g.restore()
  fill(g, [x, y, w, 1], STRIP_SHINE)
}

// A wall clock: a lobby clock keeps its pack zone's time, any other the page clock.
function paintClock(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y, w } = prop.draw
  const cx = x + w / 2
  const cy = y + w / 2
  const minuteOfDay = wallMinuteOf(prop, scene)
  const minute = minuteOfDay % MINUTES_PER_HOUR
  const hour = (minuteOfDay / MINUTES_PER_HOUR) % HOURS_ON_DIAL
  const hourAngle = (hour / HOURS_ON_DIAL) * Math.PI * 2
  const minuteAngle = (Math.floor(minute) / MINUTES_PER_HOUR) * Math.PI * 2

  framed(g, [x, y, w, w], '#FFFDF8')
  fill(g, [x, y, w, 1], '#D9CBB8')

  for (const [dx, dy] of [
    [w / 2, 0],
    [w / 2, w - 1],
    [0, w / 2],
    [w - 1, w / 2],
  ] as const) {
    fill(g, [x + dx, y + dy, 1, 1], CLOCK_TICK)
  }

  hand(g, { cx, cy, angle: hourAngle, length: HOUR_HAND_PX, color: INK })
  hand(g, { cx, cy, angle: minuteAngle, length: MINUTE_HAND_PX, color: '#3A3F58' })
  fill(g, [Math.floor(cx), Math.floor(cy), 1, 1], '#C9505A')
}

function wallMinuteOf(prop: PropDef, scene: PaintScene): number {
  const zoned = prop.room === 'lobby' ? scene.wallClocks[prop.variant ?? 0] : undefined

  return zoned ?? scene.minuteOfDay
}

function hand(
  g: CanvasRenderingContext2D,
  spec: {
    readonly cx: number
    readonly cy: number
    readonly angle: number
    readonly length: number
    readonly color: string
  }
): void {
  for (let step = 0; step <= spec.length; step++) {
    fill(
      g,
      [
        Math.floor(spec.cx + Math.sin(spec.angle) * step),
        Math.floor(spec.cy - Math.cos(spec.angle) * step),
        1,
        1,
      ],
      spec.color
    )
  }
}

function paintFrame(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y, w, h } = prop.draw

  if (faceKindOf(prop) === 'pins') {
    paintCork(g, prop.draw, scene.notes.pins)
    return
  }

  const [edge, ground, first, second] = ART[prop.variant ?? 0] ?? ART[0]

  fill(g, [x - 1, y - 1, w + 2, h + 2], edge)
  fill(g, [x, y, w, h], ground)
  fill(g, [x + 2, y + 3, Math.round(w * 0.3), Math.round(h * 0.5)], first)
  fill(g, [x, y + h - 3, w, 3], second)
}

function paintSwitch(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y, w, h } = prop.draw

  framed(g, [x + 1, y + 1, w - 2, h - 2], '#F7F3EA')
  fill(g, [x + 2, y + 2, w - 4, 5], '#C9CDD6')
  fill(g, [x + 3, scene.isAnyLit ? y + 3 : y + 5, 2, 2], scene.isAnyLit ? SWITCH_ON : SWITCH_OFF)
}

// The meeting room's wall unit; its three ribbons flutter while someone is in the room.
function paintAirCon(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y, w } = prop.draw

  fill(g, [x - 1, y - 1, w + 2, 8], INK)
  fill(g, [x, y, w, 6], AIR_CON_TONES.body)
  fill(g, [x, y + 5, w, 1], AIR_CON_TONES.vent)
  fill(g, [x + 2, y + 2, w - 4, 1], AIR_CON_TONES.line)

  for (let i = 0; i < AIR_CON_RIBBONS; i++) {
    const rx = x + 6 + i * 11
    const sway =
      scene.fx?.ribbons === true
        ? Math.round(Math.sin(scene.fx.ms / RIBBON_SWAY_MS + i * RIBBON_PHASE) * RIBBON_SWAY_PX)
        : 0

    fill(g, [rx + sway, y + 7, 1, 2], AIR_CON_TONES.ribbon)
    fill(g, [rx + sway * 2, y + 9, 1, 2], AIR_CON_TONES.ribbon)
    fill(g, [rx + sway * 3, y + 11, 1, 1], AIR_CON_TONES.ribbon)
  }
}
