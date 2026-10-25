import type { AgendaModel } from '@/web/scene/data/agenda'
import type { ScreenCache } from '@/web/scene/render2d/screens'
import type { RoomId } from '@/web/scene/types'
import type { PropDef, PropKind } from '@/web/scene/world/props'
import { castShadow, fill, framed, INK } from '@/web/scene/render2d/building'
import { MINUTES_PER_HOUR } from '@/web/text/time'

const PAPER = '#F7F5EF'
const SWITCH_ON = '#FFB340'
const SWITCH_OFF = '#8E8497'
const NOTE_TONES = ['#FFF6C9', '#FFFFFF', '#E3F0FF', '#FFE3EE', '#E6F2EA'] as const
const ART = [
  ['#D9B98F', '#BFE0F2', '#F6D69B', '#B9D9B5'],
  ['#C9B9D9', '#F2C9C2', '#BFD3EE', '#F6E3A8'],
  ['#E8C9A0', '#DCD3EE', '#F2C9D8', '#C3DCEE'],
] as const
const MARKER_TONES = ['#7C93D6', '#A596D9', '#6F7388'] as const
const HOURS_ON_DIAL = 12
const HOUR_HAND_PX = 3
const MINUTE_HAND_PX = 5
const CORK_VARIANT = 3
const MAX_RESULT_NOTES = 3
const AGENDA_VARIANTS: ReadonlySet<number> = new Set([1, 2])

/** What the props show this frame: the lamps on, the clock, the zoom, and what the boards read. */
export interface PaintScene {
  readonly lit: ReadonlySet<RoomId>
  readonly isAnyLit: boolean
  readonly minuteOfDay: number
  readonly scale: number
  readonly isPrinting: boolean
  readonly pins: number
  readonly fresh: number
  readonly unread: number
  readonly agenda: AgendaModel
  readonly screens: ScreenCache
}

export type Painter = (g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene) => void

/** The painters of what hangs on the walls: boards, screens, clocks, frames, the switch, the lift. */
export const WALL_PAINTERS = Object.freeze({
  whiteboard: paintWhiteboard,
  'results-board': paintResults,
  'wall-screen': paintWallScreen,
  clock: paintClock,
  frame: paintFrame,
  'light-switch': paintSwitch,
  'lift-door': paintLiftDoor,
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

// The results board: one pinned note per call the day landed, at most three.
function paintResults(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  paintCork(g, prop.draw, Math.min(MAX_RESULT_NOTES, scene.fresh))
}

function paintCork(g: CanvasRenderingContext2D, rect: PropDef['draw'], notes: number): void {
  const { x, y, w, h } = rect
  const noteW = Math.floor(w / 3) - 2

  framed(g, [x, y, w, h], '#B88A5C')
  fill(g, [x + 1, y + 1, w - 2, h - 2], '#C99B6A')

  for (let i = 0; i < notes; i++) {
    const nx = x + 2 + (i % 3) * (noteW + 1) + (i >= 3 ? 2 : 0)
    const ny = y + 2 + (i >= 3 ? Math.floor(h / 2) : 0)

    fill(g, [nx, ny, noteW, Math.floor(h / 2) - 3], NOTE_TONES[i % NOTE_TONES.length] ?? PAPER)
    fill(g, [nx + 1, ny + 2, noteW - 3, 1], '#9AA0B4')
  }
}

function paintWallScreen(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y, w, h } = prop.draw

  fill(g, [x - 1, y - 1, w + 2, h + 2], INK)

  if (AGENDA_VARIANTS.has(prop.variant ?? 0)) {
    scene.screens.drawAgenda(g, prop, { model: scene.agenda, scale: scene.scale })
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

  if (prop.variant === CORK_VARIANT) {
    paintCork(g, prop.draw, scene.pins)
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

function paintLiftDoor(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w, h } = prop.draw

  framed(g, [x, y, w, h], '#C9C2B8')
  fill(g, [x + 2, y + 2, w - 4, h - 2], '#C9D0DB')
  fill(g, [x + w / 2, y + 2, 1, h - 2], '#9AA3B2')
  framed(g, [x + 3, y - 8, w - 6, 5], '#262A3A')
}
