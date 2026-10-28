import type { MessageKey } from '@/i18n'
import type { PaintPart, StreetMinute } from '@/web/scene/render2d/street/paint'
import type { FrontView, ShopKind } from '@/web/scene/street-types'
import type { Point } from '@/web/scene/types'
import type { RegionPack } from '@/web/scene/world/regions'
import { paintShop } from '@/web/scene/render2d/street/shop-art'
import { mixTone, NIGHT_TONE } from '@/web/scene/render2d/street/tone'
import { paintLateCart } from '@/web/scene/render2d/street/vendor-carts'
import { isLateNight, SHOP_RISE, shopSpansOf } from '@/web/scene/world/frontage'
import { isShopOpen, type ShopRow } from '@/web/scene/world/regions'
import { NORTH } from '@/web/scene/world/street-layout'
import { tr } from '@/web/text/tr'

const SHOP_WORDS: Readonly<Partial<Record<ShopKind, MessageKey>>> = Object.freeze({
  cafe: 'ui.office.street.shop.cafe',
  store: 'ui.office.street.shop.store',
  pharmacy: 'ui.office.street.shop.pharmacy',
  food: 'ui.office.street.shop.food',
  bank: 'ui.office.street.shop.bank',
})
const BACKING = '#B4AD9F'
const BACKING_NIGHT = 0.5
const SEAM = '#8F8878'
// The late stall stands at the row's west end, a little way out on the pavement; its cook.
const STALL = Object.freeze({ inset: 14, depth: 6, skin: '#C99A78' })
const GUARD = Object.freeze({
  shadow: 'rgba(0,0,0,.16)',
  pants: '#252C3A',
  coat: '#2F4466',
  strip: '#F4E7B0',
  badge: '#D9B44A',
  skin: '#D9AE86',
  cap: '#1F2C44',
  night: 0.3,
  stridePx: 1.2,
})

/** The shop row on the far pavement either side of the frontage building: each front's sign in
 *  its own colours with its name or kind's word, awning, window and door, café tables, open by the page clock or behind its roller
 *  shutter; a late stall and the guard after the shops close. A shutter on the move and the guard
 *  are drawn on the moving layer. */
export const SHOPS_PART: PaintPart = {
  paintStatic: (g, pack, minute) => {
    paintRow(g, pack, minute)

    if (isLateNight(pack, minute.clock)) {
      paintStall(g, { pack, minute })
    }
  },
  paintMoving: (g, view, scene) => {
    const dark = scene.minute.light.dark

    paintShutters(g, { pack: scene.pack, front: view.front, minute: scene.minute, dark })
    paintGuard(g, view.front, dark)
  },
}

// The backing wall the fronts stand on, then each front but the lobby's (the frontage building
// paints that), then the seams where two fronts meet.
function paintRow(g: CanvasRenderingContext2D, pack: RegionPack, minute: StreetMinute): void {
  const spans = shopSpansOf(pack.shops)
  const first = spans[0]
  const last = spans.at(-1)
  const dark = minute.light.dark

  if (first === undefined || last === undefined) {
    return
  }

  g.fillStyle = mixTone(BACKING, NIGHT_TONE, dark * BACKING_NIGHT)
  g.fillRect(first.x, NORTH.farTop - SHOP_RISE, last.x + last.w - first.x, SHOP_RISE + 2)

  for (const span of spans) {
    if (span.row.kind !== 'lobby') {
      g.save()
      g.translate(span.x, NORTH.farTop)
      paintShop(g, {
        span,
        isOpen: isShopOpen(span.row, minute.clock),
        dark,
        detail: minute.detail,
        word: wordOf(span.row),
      })
      g.restore()
    }
  }

  g.fillStyle = mixTone(SEAM, NIGHT_TONE, dark * BACKING_NIGHT)

  for (const span of spans.slice(1)) {
    g.fillRect(span.x - 0.2, NORTH.farTop - SHOP_RISE, 0.4, SHOP_RISE + 2)
  }
}

/** Where the late stall stands: at the shop row's west end, out on the pavement. */
export function lateStallOf(pack: RegionPack): Point | undefined {
  const first = shopSpansOf(pack.shops)[0]

  return first === undefined
    ? undefined
    : { x: first.x + STALL.inset, y: NORTH.farTop + STALL.depth }
}

// A noodle cart under a hanging bulb at the row's west end, clear of the shelters.
function paintStall(
  g: CanvasRenderingContext2D,
  at: { readonly pack: RegionPack; readonly minute: StreetMinute }
): void {
  const place = lateStallOf(at.pack)

  if (place !== undefined) {
    paintLateCart(
      { g, dark: at.minute.light.dark, detail: at.minute.detail },
      { ...place, skin: STALL.skin }
    )
  }
}

interface ShutterJob {
  readonly pack: RegionPack
  readonly front: FrontView
  readonly minute: StreetMinute
  readonly dark: number
}

// A shop front redrawn with the lights of an open one under its half-moved shutter, over the
// closed one the static layer holds.
function paintShutters(g: CanvasRenderingContext2D, job: ShutterJob): void {
  const spans = shopSpansOf(job.pack.shops)

  for (const { shop, drop } of job.front.shutters) {
    const span = spans[shop]

    if (span !== undefined) {
      g.save()
      g.translate(span.x, NORTH.farTop)
      paintShop(g, {
        span,
        isOpen: true,
        dark: job.dark,
        detail: job.minute.detail,
        word: wordOf(span.row),
        drop,
      })
      g.restore()
    }
  }
}

// The shop's own name, else its kind's word; a shutter or an alley shows none.
function wordOf(row: ShopRow): string | undefined {
  const word = SHOP_WORDS[row.kind]

  return row.name ?? (word === undefined ? undefined : tr(word))
}

// The guard in a reflective coat and cap, walking the frontage; his legs swap every stride.
function paintGuard(g: CanvasRenderingContext2D, front: FrontView, dark: number): void {
  const guard = front.guard

  if (guard === undefined) {
    return
  }

  const { x, y } = guard.at
  const tone = (hex: string): string => mixTone(hex, NIGHT_TONE, dark * GUARD.night)
  const step = Math.floor(x / GUARD.stridePx) % 2 === 0 ? 0.4 : -0.4

  g.fillStyle = GUARD.shadow
  g.fillRect(x - 1.6, y - 0.4, 3.2, 0.8)
  g.fillStyle = tone(GUARD.pants)
  g.fillRect(x - 0.9 + step, y - 2.2, 0.8, 2.2)
  g.fillRect(x + 0.1 - step, y - 2.2, 0.8, 2.2)
  g.fillStyle = tone(GUARD.coat)
  g.fillRect(x - 1, y - 4.8, 2, 2.7)
  g.fillStyle = GUARD.strip
  g.fillRect(x - 0.2, y - 4.8, 0.4, 2.7)
  g.fillStyle = tone(GUARD.badge)
  g.fillRect(x - 0.7, y - 4.5, 0.35, 0.35)
  g.fillStyle = tone(GUARD.skin)
  g.beginPath()
  g.arc(x, y - 5.6, 0.85, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = tone(GUARD.cap)
  g.fillRect(x - 1, y - 6.6, 2, 0.8)
}
