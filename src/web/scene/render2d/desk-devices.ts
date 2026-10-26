import type { PaintScene } from '@/web/scene/render2d/wall-props'
import { fill, INK } from '@/web/scene/render2d/building'
import { paintStandby } from '@/web/scene/render2d/standby'
import { DEVICE_TONES, PALETTE } from '@/web/scene/sprites/palette'
import { paintPixelText, pixelTextWidth } from '@/web/scene/sprites/pixel-font'
import { seedOf } from '@/web/scene/world/rng'

type Box = readonly [number, number, number, number]

const SCREEN_DOTS = ['#FF6259', '#F2C46C', '#6FE3D6'] as const
// The approval light breathes between these on the ambient clock, steady at full under reduced
// motion; its glow is this share of the light.
const CUE_REST = 0.675
const CUE_SWING = 0.325
const CUE_PERIOD_MS = 1100
const CUE_GLOW = 0.3

/** A monitor standing on a desk at `x`, its outlined screen `w` wide from `y`: dark once the
 *  office is quiet, else its idle screen; a working screen's content is the overlay's. */
export function paintMonitor(
  g: CanvasRenderingContext2D,
  box: { readonly x: number; readonly y: number; readonly w: number },
  scene: PaintScene
): void {
  const { x, y, w } = box
  const cx = x + w / 2

  fill(g, [x, y, w, 10], INK)
  paintIdleScreen(g, [x + 1, y + 1, w - 2, 8], scene.life.isQuiet)
  fill(g, [cx - 1, y + 10, 2, 1], DEVICE_TONES.stand)
  fill(g, [cx - 3, y + 11, 6, 1], DEVICE_TONES.stand)
}

function paintIdleScreen(g: CanvasRenderingContext2D, box: Box, isQuiet: boolean): void {
  if (isQuiet) {
    fill(g, box, DEVICE_TONES.screenDark)
    return
  }

  paintScreenTop(g, box)
  fill(g, box, DEVICE_TONES.screenDim)
}

// A lit screen's ground and its window bar with the three dots.
function paintScreenTop(g: CanvasRenderingContext2D, box: Box): void {
  const [x, y, w] = box

  fill(g, box, DEVICE_TONES.screenIdle)
  fill(g, [x, y, w, 1], DEVICE_TONES.screenBar)

  for (const [i, tone] of SCREEN_DOTS.entries()) {
    fill(g, [x + 1 + i * 2, y, 1, 1], tone)
  }
}

/** The store keeper's wall monitor in its bezel: a bar of the refresh while the store fills its
 *  prices, else the idle screen, dark once the office is quiet. */
export function paintWallMonitor(
  g: CanvasRenderingContext2D,
  rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  scene: PaintScene
): void {
  const { x, y, w, h } = rect
  const screen = [x + 3, y + 3, w - 6, h - 8] as const
  const progress = scene.life.isQuiet ? undefined : scene.refreshShare

  fill(g, [x + 1, y + 1, w - 2, h - 2], INK)
  fill(g, [x + 2, y + 2, w - 4, h - 4], DEVICE_TONES.bezel2)

  if (progress === undefined) {
    paintIdleScreen(g, screen, scene.life.isQuiet)
    return
  }

  const [sx, sy, sw, sh] = screen
  const inner = sw - 2

  paintScreenTop(g, screen)
  fill(g, [sx + 1, sy + Math.floor(sh / 2), inner, 2], DEVICE_TONES.track)
  fill(
    g,
    [sx + 1, sy + Math.floor(sh / 2), Math.round(inner * progress), 2],
    DEVICE_TONES.trackFill
  )
  fill(g, [sx + 1, sy + 2, Math.round(inner / 2), 1], DEVICE_TONES.trackTitle)
}

/** The keyboard on a desk whose top is at `top`: before the standing monitor centred on `cx`, or
 *  pulled forward past the screen laid flat while someone sits there. */
export function paintKeyboard(
  g: CanvasRenderingContext2D,
  at: { readonly cx: number; readonly top: number; readonly isSeated: boolean }
): void {
  const { cx, top } = at

  if (at.isSeated) {
    fill(g, [cx - 3, top + 10, 9, 2], DEVICE_TONES.keys)
    return
  }

  fill(g, [cx - 3, top + 5, 9, 3], DEVICE_TONES.keys)
  fill(g, [cx - 3, top + 7, 9, 1], DEVICE_TONES.keysEdge)
}

/** A monitor laid flat on its desk, its glass at `screen`, in its dark frame. */
export function paintFlatMonitor(
  g: CanvasRenderingContext2D,
  screen: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  scene: PaintScene
): void {
  const { x, y, w, h } = screen

  fill(g, [x - 1, y - 1, w + 2, h + 2], INK)
  paintIdleScreen(g, [x, y, w, h], scene.life.isQuiet)
}

/** A small silver desktop box with its mark on top and its front ports. */
export function paintStudio(g: CanvasRenderingContext2D, x: number, y: number): void {
  const [top, edge, side, base] = DEVICE_TONES.studio
  const mark = DEVICE_TONES.studioMark

  fill(g, [x + 2, y, 8, 9], INK)
  fill(g, [x + 3, y + 1, 6, 4], top)
  fill(g, [x + 3, y + 1, 6, 1], edge)
  fill(g, [x + 3, y + 5, 6, 3], side)
  fill(g, [x + 3, y + 8, 6, 1], base)
  fill(g, [x + 5, y + 2, 1, 1], mark)
  fill(g, [x + 4, y + 3, 3, 1], mark)
  fill(g, [x + 4, y + 4, 1, 1], mark)
  fill(g, [x + 6, y + 4, 1, 1], mark)
  fill(g, [x + 4, y + 6, 2, 1], DEVICE_TONES.port)
  fill(g, [x + 6, y + 6, 2, 1], DEVICE_TONES.portWide)
  fill(g, [x + 8, y + 6, 1, 1], DEVICE_TONES.statusOff)
}

/** A phone lying screen up, its finish picked by `owner`; its screen stays dark glass. */
export function paintPhone(
  g: CanvasRenderingContext2D,
  at: { x: number; y: number; owner: string }
) {
  const { x, y } = at
  const frames = DEVICE_TONES.phoneFrames
  const [body, edge] = frames[seedOf(at.owner) % frames.length] ?? frames[0]

  fill(g, [x + 1, y + 1, 5, 10], DEVICE_TONES.contact)
  fill(g, [x, y, 5, 10], body)
  fill(g, [x, y, 5, 1], edge)
  fill(g, [x, y + 1, 1, 9], edge)
  fill(g, [x + 1, y + 1, 3, 8], DEVICE_TONES.bezel)
  fill(g, [x + 1, y + 2, 3, 7], DEVICE_TONES.phoneOff)
  fill(g, [x + 2, y + 1, 1, 1], DEVICE_TONES.bezel)
  fill(g, [x + 3, y + 4, 1, 3], DEVICE_TONES.glint)
}

/** A coffee mug seen from above: its shadow, the cup, the coffee and the handle on the right. */
export function paintMug(g: CanvasRenderingContext2D, x: number, y: number): void {
  for (const [shift, tone] of [
    [1, DEVICE_TONES.contact],
    [0, PALETTE.paper],
  ] as const) {
    fill(g, [x - 1 + shift, y - 2 + shift, 2, 1], tone)
    fill(g, [x - 2 + shift, y - 1 + shift, 4, 3], tone)
    fill(g, [x - 1 + shift, y + 2 + shift, 2, 1], tone)
  }

  fill(g, [x - 1, y - 1, 2, 2], DEVICE_TONES.coffee)
  fill(g, [x + 2, y - 1, 2, 1], PALETTE.paper)
  fill(g, [x + 3, y, 1, 1], PALETTE.paper)
  fill(g, [x + 2, y + 1, 2, 1], PALETTE.paper)
}

/** A bin: beside a desk, at the front desk and by yours. */
export function paintBin(g: CanvasRenderingContext2D, x: number, y: number): void {
  fill(g, [x, y, 5, 6], INK)
  fill(g, [x + 1, y + 1, 3, 4], DEVICE_TONES.bin[1])
  fill(g, [x, y, 5, 1], DEVICE_TONES.bin[0])
}

/** A desk calendar whose page shows `day`. */
function paintCalendar(g: CanvasRenderingContext2D, at: { x: number; y: number; day: string }) {
  const { x, y, day } = at

  fill(g, [x - 1, y - 1, 10, 11], INK)
  fill(g, [x, y, 8, 9], DEVICE_TONES.page)
  fill(g, [x, y, 8, 2], DEVICE_TONES.calendarHead)
  fill(g, [x + 1, y - 1, 1, 1], INK)
  fill(g, [x + 6, y - 1, 1, 1], INK)
  paintPixelText(g, day, {
    x: x + Math.floor((8 - pixelTextWidth(day)) / 2),
    y: y + 3,
    color: INK,
  })
}

/** Your desk's things, from its top-left corner: the desktop box, both keyboards, the in-tray
 *  (its stack is the tray painter's) with the amber light while an approval waits, a red mug, a
 *  snack, a StandBy stand, sticky notes and today's calendar page. */
export function paintOperatorDesk(
  g: CanvasRenderingContext2D,
  at: { readonly x: number; readonly y: number },
  scene: PaintScene
): void {
  const { x, y } = at
  const op = DEVICE_TONES.operator

  paintStudio(g, x + 82, y + 1)

  for (const dx of [19, 67]) {
    fill(g, [x + dx, y + 5, 12, 3], DEVICE_TONES.keys)
  }

  fill(g, [x + 8, y + 3, 10, 9], INK)
  fill(g, [x + 9, y + 4, 8, 7], op.tray)

  if (scene.isAwaitingYou) {
    const cue =
      scene.fx?.cue === true ? CUE_REST + CUE_SWING * Math.sin(scene.fx.ms / CUE_PERIOD_MS) : 1

    fill(g, [x + 15, y + 3, 4, 4], `rgba(${op.cueRgb},${(CUE_GLOW * cue).toFixed(2)})`)
    fill(g, [x + 16, y + 4, 2, 2], `rgba(${op.cueRgb},${(0.5 + 0.5 * cue).toFixed(2)})`)
  }

  fill(g, [x + 32, y + 4, 4, 4], op.mug)
  fill(g, [x + 33, y + 8, 2, 1], op.mugShade)
  fill(g, [x + 40, y + 5, 4, 3], INK)
  fill(g, [x + 41, y + 5, 3, 2], op.snack)
  fill(g, [x + 43, y + 4, 2, 1], op.snackTip)
  paintCalendar(g, { x: x + 70, y: y + 6, day: scene.dayOfMonth })
  paintStandby(g, { x: x + 46, y: y + 3, view: 'flow' }, scene)

  for (const [dx, dy, tone] of op.notes) {
    fill(g, [x + dx, y + dy, 2, 2], tone)
  }
}

/** The meeting table's things, from its top-left corner: two papers, a dark pad, the name
 *  placards round it, a glass, notepads and two StandBy stands, a widgets one and a clock. */
export function paintMeetingTable(
  g: CanvasRenderingContext2D,
  at: { readonly x: number; readonly y: number },
  scene: PaintScene
): void {
  const { x, y } = at
  const meet = DEVICE_TONES.meeting

  fill(g, [x + 14, y + 4, 16, 10], PALETTE.paper)
  fill(g, [x + 94, y + 4, 14, 10], PALETTE.paper)
  fill(g, [x + 128, y + 4, 8, 6], meet.pad)

  for (const [dx, dy] of meet.placards) {
    fill(g, [x + dx, y + dy, 7, 2], INK)
    fill(g, [x + dx + 1, y + dy, 5, 1], DEVICE_TONES.page)
  }

  fill(g, [x + 32, y + 5, 3, 6], meet.glass)
  fill(g, [x + 35, y + 7, 1, 2], meet.glass)

  for (let i = 0; i < 3; i++) {
    fill(g, [x + 38 + i * 4, y + 8, 3, 3], DEVICE_TONES.page)
  }

  paintStandby(g, { x: x + 58, y: y + 2, view: 'widgets' }, scene)
  paintStandby(g, { x: x + 112, y: y + 2, view: 'clocks' }, scene)
}
