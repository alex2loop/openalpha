import type { DeskFocus, DeskView, TeamView } from '@/web/scene/types'
import { fill, INK } from '@/web/scene/render2d/building'
import { paintBinWaste } from '@/web/scene/render2d/desk-devices'
import { paintCalendarAt } from '@/web/scene/render2d/desk-items'
import { binFill } from '@/web/scene/sim/bins'
import { FOCUS_TONES, PROP_TONES } from '@/web/scene/sprites/palette'
import { DESK_SLOTS } from '@/web/scene/world/floors'

/** One thing the team floor adds to the y-sorted paint. */
interface TeamPiece {
  readonly sortY: number
  readonly tie: number
  readonly draw: () => void
}

/** How the team floor's effects move this frame. */
interface TeamFrame {
  readonly now: number
  readonly isReduced: boolean
}

// The desk's computer screen (the glass of the monitor at the desk's back) and the focus prop on
// the desk top, from the desk top's corner.
const SCREEN_DX = 13
const SCREEN_DY = -10
const SCREEN_W = 14
const SCREEN_H = 7
const ITEM_DX = 28
const ITEM_DY = 2
// Drawn just over the desk and the computer, which sorts a px under the desk's bottom.
const DESK_BOTTOM = 20
const SCREEN_SORT_DY = DESK_BOTTOM + 1.5
const ITEM_SORT_LIFT = 0.5
// The bin beside the desk, from the desk top's corner, as the desk paints it.
const BIN_AT = Object.freeze({ dx: -6, dy: 8 })
const PIECE_TIE = 1
const SCREEN_LINE = '#E8F0FF'
const GLOW_RGB = '120,160,255'
const GLOW_RADIUS = 22
const GLOW_ALPHA = 0.32
const THREAD_STEP_PX = 6
const THREAD_DOT = 2
const THREAD_PHASES = 3
const THREAD_TICK_MS = 120
const THREAD_OFF = 'rgba(78,108,168,.35)'
const BURST_PHASES = 4
const BURST_TICK_MS = 140
const BURST_SPARKS: readonly (readonly [number, number])[] = Object.freeze([
  [-12, 0],
  [12, 0],
  [0, -7],
  [-8, -5],
  [8, -5],
  [-8, 5],
  [8, 5],
  [0, 7],
])

type Painter = (g: CanvasRenderingContext2D, x: number, y: number) => void

const FOCUS_PAINTERS: Readonly<Record<DeskFocus, Painter>> = Object.freeze({
  safe: (g, x, y) => {
    fill(g, [x, y, 9, 8], INK)
    fill(g, [x + 1, y + 1, 7, 6], FOCUS_TONES.safe)
    fill(g, [x + 3, y + 3, 3, 2], '#D9DCE6')
    fill(g, [x + 6, y + 3, 1, 2], INK)
  },
  candles: (g, x, y) => {
    fill(g, [x, y, 10, 8], INK)
    fill(g, [x + 1, y + 1, 8, 6], FOCUS_TONES.candles)
    fill(g, [x + 2, y + 3, 1, 3], '#32D74B')
    fill(g, [x + 4, y + 2, 1, 3], '#FF6259')
    fill(g, [x + 6, y + 2, 1, 4], '#32D74B')
  },
  gold: (g, x, y) => {
    fill(g, [x, y + 3, 10, 5], INK)
    fill(g, [x + 1, y + 4, 8, 3], FOCUS_TONES.gold)
    fill(g, [x + 2, y + 4, 6, 1], '#F4DA9C')
  },
  piggy: (g, x, y) => {
    fill(g, [x + 1, y + 2, 8, 6], INK)
    fill(g, [x + 2, y + 3, 6, 4], FOCUS_TONES.piggy)
    fill(g, [x + 7, y + 4, 2, 2], '#CB8EB3')
    fill(g, [x + 4, y + 1, 2, 1], INK)
    fill(g, [x + 3, y + 4, 1, 1], INK)
  },
})

/** Each own agent's desk prop, and the screen of a desk where someone works, y-sorted with the
 *  rest of the floor. */
export function buildTeamPieces(g: CanvasRenderingContext2D, team: TeamView): TeamPiece[] {
  return team.desks.flatMap((desk) => deskPieces(g, desk, team.calendar?.slot === desk.slot))
}

function deskPieces(
  g: CanvasRenderingContext2D,
  desk: DeskView,
  hasCalendar: boolean
): TeamPiece[] {
  const slot = DESK_SLOTS[desk.slot]

  if (slot === undefined) {
    return []
  }

  const { x, y } = slot
  const pieces: TeamPiece[] = []
  const focus = desk.focus

  if (desk.isLit) {
    pieces.push({ sortY: y + SCREEN_SORT_DY, tie: PIECE_TIE, draw: () => paintScreen(g, x, y) })
  }

  if (focus !== undefined) {
    pieces.push({
      sortY: y + DESK_BOTTOM + ITEM_SORT_LIFT,
      tie: PIECE_TIE,
      draw: () => FOCUS_PAINTERS[focus](g, x + ITEM_DX, y + ITEM_DY),
    })
  }

  const waste = desk.agentId === undefined ? 0 : (binFill.value.byAgent.get(desk.agentId) ?? 0)

  if (waste > 0) {
    pieces.push({
      sortY: y + DESK_BOTTOM + ITEM_SORT_LIFT,
      tie: PIECE_TIE,
      draw: () => paintBinWaste(g, { x: x + BIN_AT.dx, y: y + BIN_AT.dy }, waste),
    })
  }

  if (hasCalendar) {
    pieces.push({
      sortY: y + DESK_BOTTOM + ITEM_SORT_LIFT,
      tie: PIECE_TIE,
      draw: () => paintCalendarAt(g, slot),
    })
  }

  return pieces
}

function paintScreen(g: CanvasRenderingContext2D, x: number, y: number): void {
  fill(g, [x + SCREEN_DX, y + SCREEN_DY, SCREEN_W, SCREEN_H], PROP_TONES.screenLit)
  fill(g, [x + SCREEN_DX + 2, y + SCREEN_DY + 2, SCREEN_W - 6, 1], SCREEN_LINE)
  fill(g, [x + SCREEN_DX + 2, y + SCREEN_DY + 5, SCREEN_W - 8, 1], SCREEN_LINE)
}

/** The cool glow of every desk whose agent is not paused, in `lighter` blend after the light pass. */
export function paintTeamGlow(g: CanvasRenderingContext2D, team: TeamView): void {
  g.globalCompositeOperation = 'lighter'

  for (const desk of team.desks.filter((held) => held.isGlowing)) {
    const slot = DESK_SLOTS[desk.slot]

    if (slot !== undefined) {
      const cx = slot.x + SCREEN_DX + SCREEN_W / 2
      const cy = slot.y + SCREEN_DY + SCREEN_H / 2
      const gradient = g.createRadialGradient(cx, cy, 0, cx, cy, GLOW_RADIUS)

      gradient.addColorStop(0, `rgba(${GLOW_RGB},${GLOW_ALPHA})`)
      gradient.addColorStop(1, `rgba(${GLOW_RGB},0)`)
      g.fillStyle = gradient
      g.fillRect(cx - GLOW_RADIUS, cy - GLOW_RADIUS, GLOW_RADIUS * 2, GLOW_RADIUS * 2)
    }
  }

  g.globalCompositeOperation = 'source-over'
}

/** The dotted threads from parents to their open children, and the scored calls' bursts. */
export function paintTeamTop(g: CanvasRenderingContext2D, team: TeamView, frame: TeamFrame): void {
  const phase = frame.isReduced ? 0 : Math.floor(frame.now / THREAD_TICK_MS) % THREAD_PHASES

  for (const thread of team.threads) {
    const steps = Math.max(
      1,
      Math.round(
        Math.hypot(thread.to.x - thread.from.x, thread.to.y - thread.from.y) / THREAD_STEP_PX
      )
    )

    for (let i = 0; i <= steps; i++) {
      const x = Math.round(thread.from.x + ((thread.to.x - thread.from.x) * i) / steps)
      const y = Math.round(thread.from.y + ((thread.to.y - thread.from.y) * i) / steps)

      fill(
        g,
        [x, y, THREAD_DOT, THREAD_DOT],
        (i + phase) % THREAD_PHASES === 0 ? PROP_TONES.threadOn : THREAD_OFF
      )
    }
  }

  for (const burst of team.bursts) {
    paintBurst(g, burst, frame)
  }
}

function paintBurst(
  g: CanvasRenderingContext2D,
  burst: TeamView['bursts'][number],
  frame: TeamFrame
): void {
  const { x, y } = burst.at

  if (burst.tone === 'stop') {
    fill(g, [x - 8, y - 2, 16, 5], PROP_TONES.cloud[0])
    fill(g, [x - 5, y - 5, 10, 4], PROP_TONES.cloud[1])
    return
  }

  const step = frame.isReduced
    ? BURST_PHASES - 1
    : Math.floor((frame.now - burst.since) / BURST_TICK_MS) % BURST_PHASES
  const spread = 1 + step / (BURST_PHASES - 1)

  for (const [dx, dy] of BURST_SPARKS) {
    fill(g, [Math.round(x + dx * spread), Math.round(y + dy * spread), 3, 3], PROP_TONES.burst)
  }
}

/** Threads and bursts move while they show; reduced motion holds them still. */
export function isTeamMoving(team: TeamView, isReduced: boolean): boolean {
  return !isReduced && (team.threads.length > 0 || team.bursts.length > 0)
}
