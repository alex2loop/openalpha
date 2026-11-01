import type { Point, Rect } from '@/web/scene/types'
import { isWithin, type RegionPack, type ShopRow, shopDoorOf } from '@/web/scene/world/regions'
import { METRES_PER_PX, NORTH } from '@/web/scene/world/street-layout'

/** How high a shop's front rises over the far pavement. */
export const SHOP_RISE = 13

// The frontage building's shape, in world px: its height over the pavement, the glass shopfront at
// its foot, the LED board's size and where it sits (down from the roof line, in from the right
// edge), the ticker band below it, and the holiday banner above it.
const FRONT = Object.freeze({
  rise: 79,
  glass: 11,
  board: { w: 80, h: 29, top: 27, right: 3 },
  band: { h: 10, top: 58 },
  banner: { top: 8, inset: 11, h: 12 },
})

/** One front of the shop row on the far pavement: its row, its place and its door. */
export interface ShopSpan {
  readonly row: ShopRow
  readonly x: number
  readonly w: number
  readonly door: Point
}

/** The building across from the office, and the LED board, ticker band and holiday banner on its
 *  face, all in world px. */
export interface Frontage {
  readonly body: Rect
  readonly glass: Rect
  readonly board: Rect
  readonly band: Rect
  readonly banner: Rect
}

const spansByRow = new WeakMap<readonly ShopRow[], readonly ShopSpan[]>()
const frontageByRow = new WeakMap<readonly ShopRow[], Frontage | undefined>()

/** Every front of the shop row, left to right, at the scene scale. Pack rows are fixed data, so
 *  the answer is built once per row list. */
export function shopSpansOf(shops: readonly ShopRow[]): readonly ShopSpan[] {
  const held = spansByRow.get(shops)

  if (held !== undefined) {
    return held
  }

  const spans = shops.map((row, index): ShopSpan => {
    const door = shopDoorOf(shops, index)
    const w = row.frontageM / METRES_PER_PX

    return { row, x: door.x - w / 2, w, door }
  })

  spansByRow.set(shops, spans)

  return spans
}

/** From where the first front of the shop row starts to where the last one ends; absent without
 *  a row. */
export function shopRowSpanOf(shops: readonly ShopRow[]): readonly [number, number] | undefined {
  const spans = shopSpansOf(shops)
  const first = spans[0]
  const last = spans.at(-1)

  return first === undefined || last === undefined ? undefined : [first.x, last.x + last.w]
}

/** The frontage building: the lobby's front, with its board and band on the face; absent in a
 *  region whose row has no lobby. */
export function frontageOf(shops: readonly ShopRow[]): Frontage | undefined {
  if (frontageByRow.has(shops)) {
    return frontageByRow.get(shops)
  }

  const lobby = shopSpansOf(shops).find((span) => span.row.kind === 'lobby')
  const front = lobby === undefined ? undefined : buildFrontage(lobby)

  frontageByRow.set(shops, front)

  return front
}

function buildFrontage(lobby: ShopSpan): Frontage {
  const { board, band, banner } = FRONT
  const body: Rect = { x: lobby.x, y: NORTH.farTop - FRONT.rise, w: lobby.w, h: FRONT.rise }
  const faceX = body.x + body.w - board.w - board.right

  return {
    body,
    glass: { x: body.x, y: NORTH.farTop - FRONT.glass, w: body.w, h: FRONT.glass },
    board: { x: faceX, y: body.y + board.top, w: board.w, h: board.h },
    band: { x: faceX, y: body.y + band.top, w: board.w, h: band.h },
    banner: {
      x: body.x + banner.inset,
      y: body.y + banner.top,
      w: body.w - 2 * banner.inset,
      h: banner.h,
    },
  }
}

/** `minute` of the page day falls in the pack's late hours. */
export function isLateNight(pack: RegionPack, minute: number): boolean {
  return isWithin(pack.hours.late, minute)
}

/** `minute` of the page day falls in the dead of night, when the tower and the frontage put their
 *  lights out. */
export function isLightsOut(pack: RegionPack, minute: number): boolean {
  return isWithin(pack.hours.lightsOut, minute)
}
