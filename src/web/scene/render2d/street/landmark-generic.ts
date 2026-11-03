import type { Rect } from '@/web/scene/types'
import type { Frontage } from '@/web/scene/world/frontage'
import { mixTone } from '@/web/scene/render2d/street/tone'
import { createRng, seedOf } from '@/web/scene/world/rng'

const GLASS = '#5F7AA0'
const PODIUM = Object.freeze({
  wall: '#46556F',
  glassDay: '#8FB3C9',
  stripe: '#C2574A',
  stripeNight: 0.5,
})
const PODIUM_NIGHT = '#2A1210'
const WHITE = '#FFFFFF'
// The share of the night's darkness a part takes: the dark faces, the lighter blocks, fins and
// frames, and the day glass of the podium and its door.
const NIGHT = Object.freeze({ face: 0.55, light: 0.5, glass: 0.6 })
// How far towards white the glass is lightened: the capping block, the crown body, its cap, the
// fins, and a window that is dark.
const LIGHTEN = Object.freeze({ block: 0.2, crown: 0.08, cap: 0.3, fin: 0.24, window: 0.16 })
// A window's opacity lit and dark (a dark one fades as the night falls, by this share), a podium
// pane's lit and by day.
const WINDOW_ALPHA = Object.freeze({ lit: 0.95, dark: 0.45, fade: 0.6 })
const PANE_ALPHA = Object.freeze({ lit: 0.9, day: 0.8 })
const EDGE_SHADOW = 'rgba(0,0,0,.12)'
const WARM = ['#FFE6A8', '#FFD27A'] as const
const WARM_SPLIT = 0.6
const SHOP_LIT = '#FFD98A'
const DOOR = Object.freeze({ frame: '#D8DCE8', glassDay: '#9FB6C8', glassLit: '#FFE6A8', halfW: 9 })
const AVIATION_RED = '#FF5A4D'
const BEACON_GAIN = 1.2
// The block over the facade's roof, the narrower crown on it (half the width) and its cap.
const DEPTH = 14
const CROWN = Object.freeze({ h: 8, cap: 4, share: 0.5, fins: 4, finInset: 4, beacon: 5.2 })
const CROWN_SEAT = 0.45
const FIN_COUNT = 14
const FIN_INSET = 3
const FIN_W = 0.8
const EDGE_SHADE = 10
const WINDOW = Object.freeze({ pitchX: 4.4, pitchY: 5.4, w: 2.6, h: 2.8, margin: 5, gap: 4 })
const STRIPE_H = 2.4
const PANES = 5
const PANE_TOP = 3.4
const PANE_INSET = 4
const PANE_GAP = 1.6

/** What the generic facade reads: the night tint (`share` of the darkness a tone takes), the share
 *  of windows lit, whether the night lights are on and how dark the sky is. */
interface GenericLook {
  readonly night: (hex: string, share: number) => string
  readonly share: number
  readonly isLit: boolean
  readonly dark: number
}

/** The generic landmark: a stepped crown over a fin-and-glass facade with a glass podium at its
 *  foot, built on the frontage building's body. The rented board and band are painted over it by
 *  the frontage, so the facade leaves their place to it. */
export function paintGenericFront(
  g: CanvasRenderingContext2D,
  frontage: Frontage,
  look: GenericLook
): void {
  const { body, glass } = frontage

  paintFacade(g, body, look)
  paintWindows(g, { body, foot: glass.y }, look)
  paintFins(g, { body, foot: glass.y }, look)
  paintCrown(g, body, look)
  paintPodium(g, glass, look)
}

function lightened(look: GenericLook, share: number, night: number): string {
  return look.night(mixTone(GLASS, WHITE, share), night)
}

function finTone(look: GenericLook): string {
  return lightened(look, LIGHTEN.fin, NIGHT.light)
}

// The glass face and the block that caps it.
function paintFacade(g: CanvasRenderingContext2D, body: Rect, look: GenericLook): void {
  g.fillStyle = look.night(GLASS, NIGHT.face)
  g.fillRect(body.x, body.y, body.w, body.h)
  g.fillStyle = lightened(look, LIGHTEN.block, NIGHT.light)
  g.fillRect(body.x, body.y - DEPTH, body.w, DEPTH)
}

// The windows in a grid, lit by the pack's share after dusk, over the whole face down to the
// podium.
function paintWindows(
  g: CanvasRenderingContext2D,
  at: { readonly body: Rect; readonly foot: number },
  look: GenericLook
): void {
  const { body } = at
  const { pitchX, pitchY, w, h, margin, gap } = WINDOW
  const cols = Math.floor((body.w - 2 * FIN_INSET) / pitchX)
  const rows = Math.floor((at.foot - gap - body.y - margin) / pitchY)
  const stepX = (body.w - 2 * FIN_INSET) / cols
  const rng = createRng(seedOf('generic-landmark'))

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const isOn = rng.next() < look.share
      const lamp = rng.next() > WARM_SPLIT ? WARM[0] : WARM[1]

      g.globalAlpha = isOn
        ? WINDOW_ALPHA.lit
        : WINDOW_ALPHA.dark * (1 - look.dark * WINDOW_ALPHA.fade)
      g.fillStyle = isOn ? lamp : mixTone(GLASS, WHITE, LIGHTEN.window)
      g.fillRect(body.x + FIN_INSET + col * stepX + FIN_W, body.y + margin + row * pitchY, w, h)
    }
  }

  g.globalAlpha = 1
}

// The vertical fins down the face, and the shade at its right edge.
function paintFins(
  g: CanvasRenderingContext2D,
  at: { readonly body: Rect; readonly foot: number },
  look: GenericLook
): void {
  const { body, foot } = at
  const step = (body.w - 2 * FIN_INSET) / FIN_COUNT

  g.fillStyle = finTone(look)

  for (let i = 0; i <= FIN_COUNT; i++) {
    g.fillRect(body.x + FIN_INSET + i * step - FIN_W / 2, body.y, FIN_W, foot - body.y)
  }

  g.fillStyle = EDGE_SHADOW
  g.fillRect(body.x + body.w - EDGE_SHADE, body.y, EDGE_SHADE, foot - body.y)
}

// The crown on the capping block: its body, a cap, four fins, and after dusk a red beacon.
function paintCrown(g: CanvasRenderingContext2D, body: Rect, look: GenericLook): void {
  const width = body.w * CROWN.share
  const x = body.x + (body.w - width) / 2
  const seat = body.y - DEPTH * CROWN_SEAT
  const top = seat - CROWN.h

  g.fillStyle = lightened(look, LIGHTEN.crown, NIGHT.face)
  g.fillRect(x, top, width, CROWN.h)
  g.fillStyle = lightened(look, LIGHTEN.cap, NIGHT.light)
  g.fillRect(x, top - CROWN.cap, width, CROWN.cap)
  g.fillStyle = finTone(look)

  const finStep = (width - 2 * CROWN.finInset) / (CROWN.fins - 1)

  for (let i = 0; i < CROWN.fins; i++) {
    g.fillRect(x + CROWN.finInset + i * finStep, top + 1, FIN_W, CROWN.h - 1)
  }

  if (look.isLit) {
    g.globalAlpha = Math.min(1, look.dark * BEACON_GAIN)
    g.fillStyle = AVIATION_RED
    g.beginPath()
    g.arc(body.x + body.w / 2, top - CROWN.beacon, FIN_W, 0, Math.PI * 2)
    g.fill()
    g.globalAlpha = 1
  }
}

// The podium: a dark wall, a red stripe along its top, glass panes lit warm after dusk and the
// door at the centre.
function paintPodium(g: CanvasRenderingContext2D, glass: Rect, look: GenericLook): void {
  const { x, y, w, h } = glass
  const step = (w - 2 * PANE_INSET) / PANES

  g.fillStyle = look.night(PODIUM.wall, NIGHT.face)
  g.fillRect(x, y, w, h)
  g.globalAlpha = look.isLit ? PANE_ALPHA.lit : PANE_ALPHA.day
  g.fillStyle = look.isLit ? SHOP_LIT : look.night(PODIUM.glassDay, NIGHT.glass)

  for (let i = 0; i < PANES; i++) {
    g.fillRect(x + PANE_INSET + i * step, y + PANE_TOP, step - PANE_GAP, h - PANE_TOP)
  }

  g.globalAlpha = 1
  g.fillStyle = mixTone(PODIUM.stripe, PODIUM_NIGHT, look.dark * PODIUM.stripeNight)
  g.fillRect(x, y + 1, w, STRIPE_H)

  const cx = x + w / 2

  g.fillStyle = look.night(DOOR.frame, NIGHT.light)
  g.fillRect(cx - DOOR.halfW, y + PANE_TOP, DOOR.halfW * 2, h - PANE_TOP)
  g.fillStyle = look.isLit ? DOOR.glassLit : look.night(DOOR.glassDay, NIGHT.glass)
  g.fillRect(cx - DOOR.halfW + 1, y + PANE_TOP + 0.8, DOOR.halfW * 2 - 2, h - PANE_TOP - 0.8)
}
