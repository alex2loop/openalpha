import type { PaintScene } from '@/web/scene/render2d/wall-props'
import type { Point } from '@/web/scene/types'
import { fill, INK } from '@/web/scene/render2d/building'
import { paintStandby } from '@/web/scene/render2d/standby'
import { isCrispTextWarm, paintCrispText } from '@/web/scene/sprites/crisp-text'
import { DEVICE_TONES, PALETTE } from '@/web/scene/sprites/palette'
import { paintPixelText, pixelTextWidth } from '@/web/scene/sprites/pixel-font'
import { hasBuildTime } from '@/web/scene/sprites/sprite-cache'
import { standingScreenOf } from '@/web/scene/world/desk-spots'
import { seedOf } from '@/web/scene/world/rng'
import { formatPercent } from '@/web/text/figures'
import { tr } from '@/web/text/tr'

type Box = readonly [number, number, number, number]

// A wall screen's line is this share of the glass's height; under this many CSS px it shows bars.
const SCREEN_TEXT_SHARE = 0.3
const SCREEN_TEXT_MIN_PX = 5.5
const PERCENT_OF = 100
const SCREEN_DOTS = ['#FF6259', '#F2C46C', '#6FE3D6'] as const
// The approval light breathes between these on the ambient clock, steady at full under reduced
// motion; its glow is this share of the light.
const CUE_REST = 0.675
const CUE_SWING = 0.325
const CUE_PERIOD_MS = 1100
const CUE_GLOW = 0.3
// The crumpled sheets heaped over a bin's rim, first to last, from its top-left corner, each this
// wide: big enough to read as a heap from the room zoom.
const WASTE_BALLS = [
  [-0.5, -2],
  [2.5, -2.4],
  [1, -4.2],
] as const
const WASTE_BALL_PX = 3
const WASTE_SHADE_PX = 0.8

/** A monitor standing on a desk at `x`, its outlined screen `w` wide from `y`: dark once the
 *  office is quiet, else its idle screen; a working screen's content is the overlay's. */
export function paintMonitor(
  g: CanvasRenderingContext2D,
  box: { readonly x: number; readonly y: number; readonly w: number },
  scene: PaintScene
): void {
  const { x, y, w } = box
  const cx = x + w / 2

  const screen = standingScreenOf(box)

  fill(g, [x, y, w, 10], INK)
  fill(g, [x + 1, y + 1, w - 2, 8], DEVICE_TONES.bezel2)
  paintIdleScreen(g, [screen.x, screen.y, screen.w, screen.h], scene.life.isQuiet)
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
  const isQuiet = scene.life.isQuiet
  const progress = isQuiet ? undefined : scene.refreshShare

  fill(g, [x + 1, y + 1, w - 2, h - 2], INK)
  fill(g, [x + 2, y + 2, w - 4, h - 4], DEVICE_TONES.bezel2)

  if (isQuiet) {
    paintIdleScreen(g, screen, true)
    return
  }

  paintScreenTop(g, screen)

  if (!paintRefreshText(g, { screen, scene, progress })) {
    paintRefreshBars(g, screen, progress)
  }

  // An idle prompt sits dimmed, as the mockup's monitor does while its owner is not working.
  if (progress === undefined) {
    fill(g, screen, DEVICE_TONES.screenDim)
  }
}

type ScreenBox = readonly [number, number, number, number]

// The bar screen for a monitor too small to read: the command as a bar and the progress bar.
function paintRefreshBars(g: CanvasRenderingContext2D, screen: ScreenBox, progress?: number): void {
  const [sx, sy, sw, sh] = screen
  const inner = sw - 2

  fill(g, [sx + 1, sy + Math.floor(sh / 2), inner, 2], DEVICE_TONES.track)
  fill(
    g,
    [sx + 1, sy + Math.floor(sh / 2), Math.round(inner * (progress ?? 0)), 2],
    DEVICE_TONES.trackFill
  )
  fill(g, [sx + 1, sy + 2, Math.round(inner / 2), 1], DEVICE_TONES.trackTitle)
}

// The mockup's refresh screen once its text reads (at least `SCREEN_TEXT_MIN_PX` CSS px): the
// command, its percent on the right while it runs, and the progress bar under it. False when
// too small, or while its first crisp text waits for a lighter frame, so the bars show instead.
function paintRefreshText(
  g: CanvasRenderingContext2D,
  at: {
    readonly screen: ScreenBox
    readonly scene: PaintScene
    readonly progress: number | undefined
  }
): boolean {
  const [sx, sy, sw, sh] = at.screen
  const fontPx = sh * SCREEN_TEXT_SHARE
  const market = at.scene.refreshMarket

  if (
    fontPx * at.scene.scale < SCREEN_TEXT_MIN_PX ||
    market === undefined ||
    !isScreenTextDue(at.scene)
  ) {
    return false
  }

  const pad = 1
  const top = sy + 3
  const bar = Math.max(1, Math.round(fontPx * 0.3))
  const inner = sw - pad * 2
  const percent =
    at.progress === undefined ? '' : formatPercent(Math.round(at.progress * PERCENT_OF))

  const perPx = at.scene.stretch
  const percentW = paintCrispText(g, percent, {
    x: sx + sw - pad,
    y: top,
    fontPx,
    perPx,
    color: DEVICE_TONES.screenText,
    align: 'right',
  })

  paintCrispText(g, tr('ui.office.store.screenLine', { market }), {
    x: sx + pad,
    y: top,
    fontPx,
    perPx,
    color: DEVICE_TONES.trackTitle,
    maxW: inner - percentW - pad,
  })
  fill(g, [sx + pad, top + fontPx * 1.4, inner, bar], DEVICE_TONES.track)
  fill(
    g,
    [sx + pad, top + fontPx * 1.4, Math.round(inner * (at.progress ?? 0)), bar],
    DEVICE_TONES.trackFill
  )

  return true
}

// The first crisp text costs a few ms, so it waits for a frame with no street repaint step and
// time left in its build slice.
function isScreenTextDue(scene: PaintScene): boolean {
  return isCrispTextWarm() || (!scene.isStreetPainting && hasBuildTime())
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

/** The day's crumpled sheets over the bin at `at`, `count` of them. */
export function paintBinWaste(g: CanvasRenderingContext2D, at: Point, count: number): void {
  for (const [dx, dy] of WASTE_BALLS.slice(0, count)) {
    fill(g, [at.x + dx, at.y + dy, WASTE_BALL_PX, WASTE_BALL_PX], PALETTE.paper)
    fill(
      g,
      [at.x + dx, at.y + dy + WASTE_BALL_PX - WASTE_SHADE_PX, WASTE_BALL_PX, WASTE_SHADE_PX],
      PALETTE.paperEdge
    )
  }
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
