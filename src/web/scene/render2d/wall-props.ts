import type { AgendaModel } from '@/web/scene/data/agenda'
import type { DetailLevel } from '@/web/scene/sim/life/animal-model'
import type { BoardNotes, ScreenCache } from '@/web/scene/sprites/screens'
import type { LifeView, LiftView, RoomId } from '@/web/scene/types'
import type { PropDef, PropKind } from '@/web/scene/world/props'
import { castShadow, fill, framed, INK } from '@/web/scene/render2d/building'
import { faceKindOf, paintCork } from '@/web/scene/sprites/screens'
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

/** What the props show this frame: the lamps on, the clock, the zoom, and what the boards read. */
export interface PaintScene {
  readonly lit: ReadonlySet<RoomId>
  readonly isAnyLit: boolean
  readonly minuteOfDay: number
  readonly scale: number
  readonly isPrinting: boolean
  readonly notes: BoardNotes
  readonly unread: number
  readonly agenda: AgendaModel
  readonly screens: ScreenCache
  readonly life: LifeView
  readonly detail: DetailLevel
  readonly isRaining: boolean
  readonly lift: LiftView
  /** Which way the tape's first name, the home index, moved: the StandBy widgets' bar. */
  readonly indexMove: 'up' | 'down' | 'flat'
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
} satisfies Partial<Record<PropKind, Painter>>)

function paintWhiteboard(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w, h } = prop.draw

  castShadow(g, [x + 2, y + h + 8, w, 3])
  framed(g, [x, y, w, h], '#FAFAFC')
  fill(g, [x, y + h - 2, w, 2], '#C9CCD6')
  fill(g, [x + 3, y + h, 2, 9], INK)
  fill(g, [x + w - 5, y + h, 2, 9], INK)

  for (const [i, tone] of MARKER_TONES.entries()) {
    const length = Math.round(w * (0.45 + (((prop.variant ?? 0) * (i + 3)) % 40) / 100))

    fill(g, [x + Math.round(w * 0.07), y + Math.round(h * (0.6 + i * 0.12)), length, 1], tone)
  }
}

function paintResults(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  paintCork(g, prop.draw, scene.notes.calls)
}

function paintWallScreen(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y, w, h } = prop.draw

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

    return
  }

  fill(g, [x, y, w, h], '#171A2B')

  // The LED strip over the alert desk shows one bar a notice still unread.
  if (prop.variant === 4 && scene.unread > 0) {
    fill(g, [x + 2, y + 3, Math.min(w - 4, scene.unread * 6), 2], '#FFD98A')
  }
}

function paintClock(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y, w } = prop.draw
  const cx = x + w / 2
  const cy = y + w / 2
  const minute = scene.minuteOfDay % MINUTES_PER_HOUR
  const hour = (scene.minuteOfDay / MINUTES_PER_HOUR) % HOURS_ON_DIAL
  const hourAngle = (hour / HOURS_ON_DIAL) * Math.PI * 2
  const minuteAngle = (minute / MINUTES_PER_HOUR) * Math.PI * 2

  framed(g, [x, y, w, w], '#FFFDF8')
  fill(g, [x, y, w, 1], '#D9CBB8')
  hand(g, { cx, cy, angle: hourAngle, length: HOUR_HAND_PX, color: INK })
  hand(g, { cx, cy, angle: minuteAngle, length: MINUTE_HAND_PX, color: '#3A3F58' })
  fill(g, [Math.floor(cx), Math.floor(cy), 1, 1], '#C9505A')
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
