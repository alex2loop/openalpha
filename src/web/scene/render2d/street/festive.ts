import type { PaintPart } from '@/web/scene/render2d/street/paint'
import type { RegionPack } from '@/web/scene/world/regions'
import {
  DRESSED_FOOT_Y,
  dressedShopsOf,
  type HangAt,
  paintGarland,
} from '@/web/scene/render2d/street/festive-dress'
import { paintFlags, paintVnFlag } from '@/web/scene/render2d/street/festive-flags'
import { paintJul4, paintThanksgiving } from '@/web/scene/render2d/street/festive-us'
import { paintLabel } from '@/web/scene/render2d/street/label'
import { mixTone, NIGHT_TONE } from '@/web/scene/render2d/street/tone'
import { frontageOf } from '@/web/scene/world/frontage'
import { type HolidayId, holidayOf } from '@/web/scene/world/regions'
import { tr } from '@/web/text/tr'

const GOLD = '#E8B94A'
const RED = '#D8271C'
const AMBER = '#E8A01E'
const LANTERN_PITCH = 8
const STAR_PITCH = 11
const BANNER_RED = '#B3201A'
const POT = Object.freeze({ clay: '#B5593A', leaf: '#3F8F4F', fruit: '#F28C1C', night: '#2A1A18' })
const FRUIT_SPOTS = [
  [-0.9, -0.4],
  [0.8, -0.9],
  [-0.1, 0.5],
  [1, 0.3],
  [-1.1, -1.5],
] as const

type HolidayPainter = (g: CanvasRenderingContext2D, pack: RegionPack, dark: number) => void

// Christmas has no dress here: its lights are the trees' own.
const HOLIDAY_PAINTERS: Readonly<Partial<Record<HolidayId, HolidayPainter>>> = Object.freeze({
  tet: paintTet,
  'trung-thu': paintMidAutumn,
  'quoc-khanh': paintNationalDay,
  jul4: paintJul4,
  thanksgiving: paintThanksgiving,
})

/** The street's holiday dress by the real date, one answer a day: on Tết lantern strings, kumquat
 *  pots and the greeting on the frontage; on Trung thu star lanterns; on Quốc khánh flags on the
 *  kerb poles, the shop row and the frontage; the US days are `festive-us`. The trees' blossom,
 *  autumn crowns and Christmas lights are the trees' own. */
export const FESTIVE_PART: PaintPart = {
  paintStatic: (g, pack, minute) => {
    const holiday = holidayOf(pack, minute.day)

    if (holiday !== undefined) {
      HOLIDAY_PAINTERS[holiday]?.(g, pack, minute.light.dark)
    }
  },
}

function paintTet(g: CanvasRenderingContext2D, pack: RegionPack, dark: number): void {
  paintGarland(g, pack, { dark, hang: lantern, pitch: LANTERN_PITCH })
  paintPots(g, pack, dark)
  paintBanner(g, pack)
}

function paintMidAutumn(g: CanvasRenderingContext2D, pack: RegionPack, dark: number): void {
  paintGarland(g, pack, { dark, hang: star, pitch: STAR_PITCH })
}

function paintNationalDay(g: CanvasRenderingContext2D, pack: RegionPack, dark: number): void {
  paintFlags(g, pack, { dark, paint: paintVnFlag })
}

function lantern(g: CanvasRenderingContext2D, at: HangAt): void {
  paintLantern(g, {
    x: at.x,
    y: at.y,
    r: 0.9,
    dark: at.dark,
    colour: at.index % 3 === 0 ? AMBER : RED,
  })
}

function star(g: CanvasRenderingContext2D, at: HangAt): void {
  paintStar(g, {
    x: at.x,
    y: at.y,
    r: 1.2,
    dark: at.dark,
    colour: at.index % 2 === 0 ? '#F2A21E' : '#E8362A',
  })
}

interface Ornament {
  readonly x: number
  readonly y: number
  readonly r: number
  readonly dark: number
  readonly colour: string
}

// A red paper lantern with a gold cap and tassel; lit after dusk.
function paintLantern(g: CanvasRenderingContext2D, o: Ornament): void {
  if (o.dark > 0.25) {
    g.globalAlpha = 0.35 * o.dark
    g.fillStyle = '#FFB04A'
    g.beginPath()
    g.arc(o.x, o.y, o.r * 2.2, 0, Math.PI * 2)
    g.fill()
    g.globalAlpha = 1
  }

  g.fillStyle = mixTone(o.colour, NIGHT_TONE, o.dark * 0.25)
  g.beginPath()
  g.ellipse(o.x, o.y, o.r * 0.82, o.r, 0, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = GOLD
  g.fillRect(o.x - o.r * 0.35, o.y - o.r - 0.25, o.r * 0.7, 0.35)
  g.fillRect(o.x - 0.08, o.y + o.r, 0.16, o.r * 0.9)
}

// A five-point star lantern with a glow after dusk.
function paintStar(g: CanvasRenderingContext2D, o: Ornament): void {
  if (o.dark > 0.25) {
    g.globalAlpha = 0.4 * o.dark
    g.fillStyle = '#FFD46A'
    g.beginPath()
    g.arc(o.x, o.y, o.r * 2, 0, Math.PI * 2)
    g.fill()
    g.globalAlpha = 1
  }

  g.fillStyle = mixTone(o.colour, NIGHT_TONE, o.dark * 0.15)
  g.beginPath()

  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + i * (Math.PI / 5)
    const reach = i % 2 === 0 ? o.r : o.r * 0.5

    g.lineTo(o.x + Math.cos(angle) * reach, o.y + Math.sin(angle) * reach)
  }

  g.closePath()
  g.fill()
  g.fillStyle = '#FFE27A'
  g.beginPath()
  g.arc(o.x, o.y, o.r * 0.28, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = GOLD
  g.fillRect(o.x - 0.08, o.y + o.r, 0.16, o.r * 0.8)
}

// A kumquat pot in front of every other shop that sells something.
function paintPots(g: CanvasRenderingContext2D, pack: RegionPack, dark: number): void {
  for (const span of dressedShopsOf(pack)) {
    const x = span.x + Math.min(2.4, span.w * 0.2)
    const y = DRESSED_FOOT_Y

    g.fillStyle = mixTone(POT.clay, POT.night, dark * 0.5)
    g.fillRect(x - 1.2, y - 1.1, 2.4, 1.5)
    g.fillStyle = mixTone(POT.leaf, '#1E3A2C', dark * 0.7)
    g.beginPath()
    g.arc(x, y - 2.7, 1.9, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = POT.fruit

    for (const [dx, dy] of FRUIT_SPOTS) {
      g.beginPath()
      g.arc(x + dx, y - 2.7 + dy, 0.38, 0, Math.PI * 2)
      g.fill()
    }
  }
}

// The greeting on a red plate across the frontage.
function paintBanner(g: CanvasRenderingContext2D, pack: RegionPack): void {
  const banner = frontageOf(pack.shops)?.banner

  if (banner === undefined) {
    return
  }

  g.fillStyle = BANNER_RED
  g.fillRect(banner.x, banner.y, banner.w, banner.h)
  g.fillStyle = GOLD
  g.fillRect(banner.x, banner.y, banner.w, 0.7)
  g.fillRect(banner.x, banner.y + banner.h - 0.7, banner.w, 0.7)
  g.beginPath()
  g.arc(banner.x + 4.2, banner.y + banner.h / 2, 1.4, 0, Math.PI * 2)
  g.arc(banner.x + banner.w - 4.2, banner.y + banner.h / 2, 1.4, 0, Math.PI * 2)
  g.fill()
  paintLabel(g, tr('ui.office.street.holiday.tet'), {
    x: banner.x + banner.w / 2,
    y: banner.y + banner.h / 2 + 0.3,
    size: 6.8,
    colour: '#FFFFFF',
    maxW: banner.w - 14,
  })
}
