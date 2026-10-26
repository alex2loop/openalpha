import type { PaintScene } from '@/web/scene/render2d/wall-props'
import { fill, INK } from '@/web/scene/render2d/building'
import { DEVICE_TONES, moveToneOf, PALETTE } from '@/web/scene/sprites/palette'
import { seedOf } from '@/web/scene/world/rng'

type Box = readonly [number, number, number, number]

/** What a StandBy phone propped on a desk shows: drifting colour, a small clock and the index's
 *  move, or the time large. */
type StandbyView = 'flow' | 'widgets' | 'clocks'

const STANDBY_PHASES = 6
const SCREEN_DOTS = ['#FF6259', '#F2C46C', '#6FE3D6'] as const

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
  const [x, y, w, h] = box

  if (isQuiet) {
    fill(g, box, DEVICE_TONES.screenDark)
    return
  }

  fill(g, box, DEVICE_TONES.screenIdle)
  fill(g, [x, y, w, 1], DEVICE_TONES.screenBar)

  for (const [i, tone] of SCREEN_DOTS.entries()) {
    fill(g, [x + 1 + i * 2, y, 1, 1], tone)
  }

  fill(g, [x, y, w, h], DEVICE_TONES.screenDim)
}

/** A keyboard in front of a monitor centred on `cx`, its top at `y`. */
export function paintKeyboard(g: CanvasRenderingContext2D, cx: number, y: number): void {
  fill(g, [cx - 3, y, 9, 3], DEVICE_TONES.keys)
  fill(g, [cx - 3, y + 2, 9, 1], DEVICE_TONES.keysEdge)
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

/** A desk bin. */
export function paintDeskBin(g: CanvasRenderingContext2D, x: number, y: number): void {
  fill(g, [x, y, 5, 6], INK)
  fill(g, [x + 1, y + 1, 3, 4], DEVICE_TONES.bin[1])
  fill(g, [x, y, 5, 1], DEVICE_TONES.bin[0])
}

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

  if (view === 'flow') {
    paintFlow(g, { x, y, phase: Math.floor(scene.minuteOfDay) % STANDBY_PHASES, tones })
  } else if (view === 'widgets') {
    paintWidgets(g, { x, y, tones, scene })
  } else {
    paintBigClock(g, { x, y, tones })
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
