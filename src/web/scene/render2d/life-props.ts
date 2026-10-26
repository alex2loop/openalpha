import type { FloorId, LifeView, Point, SteamView } from '@/web/scene/types'
import { drawBlock, fill, framed, METAL } from '@/web/scene/render2d/building'
import { detailOf, paintPet } from '@/web/scene/render2d/pets'
import { PET_FLOOR } from '@/web/scene/sim/life/pet-paths'
import { propsOn } from '@/web/scene/world/props'

const PAPER = '#F7F5EF'
const PAPER_EDGE = '#D9D4C7'
const CART_W = 20
const CART_TOP_H = 4
const CART_FRONT_H = 6
const CART_WHEEL = '#2B2433'
const CUP_TONES = ['#F6C6D6', '#FFFFFF', '#BFD3EE'] as const
const STEAM = 'rgba(255,255,255,.7)'
const BUBBLE = 'rgba(217,239,251,.95)'
const STEAM_RISE_PX = 5
const STEAM_MS = 900
const BUBBLE_MS = 1_200
// A sheet slides out of the printer over this long, then joins the stack.
const PRINT_FEED_MS = 900
// The printer's out-tray, where delivered sheets stack.
const PRINT_TRAY = propsOn('office').find((prop) => prop.kind === 'tray')
const SHEET_W = 12
const SHEET_STEP_PX = 1
const FEED_SLIDE_PX = 4
// Pets sort as people do; the cart as furniture.
const PET_TIE = 2
const CART_TIE = 1

/** One thing the office life adds to the y-sorted paint. */
interface LifePiece {
  readonly sortY: number
  readonly tie: number
  readonly draw: () => void
}

/** The pets and the dessert cart, sorted among the people and the furniture. */
export function buildLifePieces(
  g: CanvasRenderingContext2D,
  at: {
    readonly life: LifeView
    readonly floor: FloorId
    readonly alpha: number
    readonly scale: number
  }
): LifePiece[] {
  const level = detailOf(at.scale)
  const pets: LifePiece[] =
    at.floor === PET_FLOOR
      ? at.life.pets.map((pet) => ({
          sortY: pet.at.y,
          tie: PET_TIE,
          draw: () => paintPet(g, pet, { alpha: at.alpha, level }),
        }))
      : []
  const cart = at.life.cart

  return cart === undefined || cart.floor !== at.floor
    ? pets
    : [...pets, { sortY: cart.at.y, tie: CART_TIE, draw: () => paintCart(g, cart.at) }]
}

/** The printer's stack and the steam, over everything standing on the floor. */
export function paintLifeOver(
  g: CanvasRenderingContext2D,
  at: {
    readonly life: LifeView
    readonly floor: FloorId
    readonly now: number
    readonly isReduced: boolean
  }
): void {
  const { life } = at

  if (PRINT_TRAY !== undefined && at.floor === PRINT_TRAY.floor && life.sheets > 0) {
    const tray = { x: PRINT_TRAY.draw.x + PRINT_TRAY.draw.w / 2, y: PRINT_TRAY.draw.y }
    const feedK = at.isReduced ? 1 : feedKOf(life, at.now)

    paintSheets(g, tray, { count: life.sheets, feedK })
  }

  for (const steam of life.steam.filter((each) => each.floor === at.floor)) {
    paintSteam(g, steam, at.now)
  }
}

/** How far the newest sheet has come out of the printer (1 once it lies on the stack). */
export function feedKOf(life: LifeView, now: number): number {
  const feedAt = life.feedAt

  return feedAt === undefined ? 1 : Math.min(1, Math.max(0, (now - feedAt) / PRINT_FEED_MS))
}

/** The dessert cart, its wheels under it, a few cups on top. */
function paintCart(g: CanvasRenderingContext2D, at: Point): void {
  const x = Math.round(at.x - CART_W / 2)
  const y = Math.round(at.y - CART_TOP_H - CART_FRONT_H)

  drawBlock(g, [x, y, CART_W, CART_TOP_H], { front: CART_FRONT_H, tones: METAL })
  fill(g, [x + 1, y + CART_TOP_H + CART_FRONT_H, 3, 2], CART_WHEEL)
  fill(g, [x + CART_W - 4, y + CART_TOP_H + CART_FRONT_H, 3, 2], CART_WHEEL)

  CUP_TONES.forEach((tone, i) => {
    framed(g, [x + 3 + i * 6, y - 2, 3, 3], tone)
  })
}

// The printer's stack of delivered sheets on its tray; the newest slides out while it feeds.
function paintSheets(
  g: CanvasRenderingContext2D,
  tray: Point,
  stack: { readonly count: number; readonly feedK: number }
): void {
  for (let i = 0; i < stack.count; i++) {
    const isFeeding = i === stack.count - 1 && stack.feedK < 1
    const slide = isFeeding ? Math.round((1 - stack.feedK) * FEED_SLIDE_PX) : 0
    const y = Math.round(tray.y - i * SHEET_STEP_PX - slide)

    fill(g, [Math.round(tray.x - SHEET_W / 2), y, SHEET_W, 2], PAPER)
    fill(g, [Math.round(tray.x - SHEET_W / 2), y + 2, SHEET_W, 1], PAPER_EDGE)
  }
}

// Steam curling over a mug, or a bubble rising in a cooler's bottle.
function paintSteam(g: CanvasRenderingContext2D, steam: SteamView, now: number): void {
  const isMug = steam.kind === 'mug'
  const periodMs = isMug ? STEAM_MS : BUBBLE_MS
  const k = (now % periodMs) / periodMs
  const rise = Math.round(k * STEAM_RISE_PX)
  const sway = isMug && k > 0.5 ? 1 : 0
  const x = Math.round(steam.at.x) + sway
  const y = Math.round(steam.at.y) + (isMug ? -rise : STEAM_RISE_PX * 2 - rise)

  fill(g, [x, y, 1, 2], isMug ? STEAM : BUBBLE)
  fill(g, [x - 2, y + 2, 1, 1], isMug ? STEAM : BUBBLE)
}
