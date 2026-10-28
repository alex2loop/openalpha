import type { PaintPart } from '@/web/scene/render2d/street/paint'
import type { Rect } from '@/web/scene/types'
import type { RegionPack } from '@/web/scene/world/regions'
import { STREET_LEFT, STREET_RIGHT } from '@/web/scene/render2d/street/city-ground'
import { paintLabel } from '@/web/scene/render2d/street/label'
import { mixTone, NIGHT_TONE } from '@/web/scene/render2d/street/tone'
import { sheltersOf } from '@/web/scene/sim/street/flows'
import { frontageOf, shopRowSpanOf, shopSpansOf } from '@/web/scene/world/frontage'
import { holidayOf } from '@/web/scene/world/regions'
import { CROSSING, FAR_TREES, KERB_Y, NORTH } from '@/web/scene/world/street-layout'
import { tr } from '@/web/text/tr'

const GOLD = '#E8B94A'
const RED = '#D8271C'
const AMBER = '#E8A01E'
const STRING_Y = -26.4
const STRING_SAG = 2.4
const STRING_REACH = 72
const STRING_STEPS = 12
const STRING_PER_PX = 6
const ROW_EDGE = 12
const LANTERN_PITCH = 8
const STAR_PITCH = 11
const ROW_FLAG_PITCH = 25.2
const KERB_FLAG_PITCH = 54
const FLAG_CLEAR = Object.freeze({ shelter: 20, crossing: 14, row: 8 })
const ROW_BASE_Y = NORTH.farTop - 0.6
const ROW_FLAG_Y = NORTH.farTop - 0.2
// A big flag stands on each side of the frontage's top.
const FRONTAGE_FLAG = Object.freeze({ drop: 24, inset: 5, w: 11, h: 7 })
const BANNER_RED = '#B3201A'
const POT = Object.freeze({ clay: '#B5593A', leaf: '#3F8F4F', fruit: '#F28C1C', night: '#2A1A18' })
const FRUIT_SPOTS = [
  [-0.9, -0.4],
  [0.8, -0.9],
  [-0.1, 0.5],
  [1, 0.3],
  [-1.1, -1.5],
] as const

/** The street's holiday dress by the real date, one answer a day: on Tết lantern strings, kumquat
 *  pots and the greeting on the frontage; on Trung thu star lanterns; on Quốc khánh flags on the
 *  kerb poles, the shop row and the frontage. The trees' blossom and Christmas lights are the
 *  trees' own. */
export const FESTIVE_PART: PaintPart = {
  paintStatic: (g, pack, minute) => {
    const holiday = holidayOf(pack, minute.day)
    const dark = minute.light.dark

    if (holiday === 'tet') {
      paintTet(g, pack, dark)
    } else if (holiday === 'trung-thu') {
      paintStrings(g, pack, { dark, hang: star })
      paintRow(g, pack, { dark, hang: star, pitch: STAR_PITCH })
    } else if (holiday === 'quoc-khanh') {
      paintFlags(g, pack, dark)
    }
  },
}

/** Where an ornament hangs, which one it is along its string or row, and how dark it is. */
interface HangAt {
  readonly x: number
  readonly y: number
  readonly index: number
  readonly dark: number
}

interface Hang {
  readonly dark: number
  readonly hang: (g: CanvasRenderingContext2D, at: HangAt) => void
}

function paintTet(g: CanvasRenderingContext2D, pack: RegionPack, dark: number): void {
  paintStrings(g, pack, { dark, hang: lantern })
  paintRow(g, pack, { dark, hang: lantern, pitch: LANTERN_PITCH })
  paintPots(g, pack, dark)
  paintBanner(g, pack)
}

// A string of ornaments sagging between each pair of neighbouring far trees outside the shop row.
function paintStrings(g: CanvasRenderingContext2D, pack: RegionPack, hang: Hang): void {
  const row = shopRowSpanOf(pack.shops)

  for (let i = 0; i < FAR_TREES.length - 1; i++) {
    const a = FAR_TREES[i]?.x ?? 0
    const b = FAR_TREES[i + 1]?.x ?? 0
    const isNearRow = row !== undefined && a > row[0] - ROW_EDGE && b < row[1] + ROW_EDGE

    if (b - a <= STRING_REACH && !isNearRow) {
      hangString(
        g,
        { from: a, to: b, count: Math.max(3, Math.round((b - a) / STRING_PER_PX)) },
        hang
      )
    }
  }
}

function hangString(
  g: CanvasRenderingContext2D,
  string: { readonly from: number; readonly to: number; readonly count: number },
  hang: Hang
): void {
  const length = string.to - string.from
  const sagAt = (u: number): number => STRING_Y + Math.sin(u * Math.PI) * STRING_SAG

  g.strokeStyle = 'rgba(60,40,30,.55)'
  g.lineWidth = 0.22
  g.beginPath()

  for (let i = 0; i <= STRING_STEPS; i++) {
    const u = i / STRING_STEPS

    if (i === 0) {
      g.moveTo(string.from, sagAt(u))
    } else {
      g.lineTo(string.from + length * u, sagAt(u))
    }
  }

  g.stroke()

  for (let i = 1; i < string.count; i++) {
    const u = i / string.count

    hang.hang(g, { x: string.from + length * u, y: sagAt(u) + 0.6, index: i, dark: hang.dark })
  }
}

// Ornaments hung along the top of the shop row.
function paintRow(
  g: CanvasRenderingContext2D,
  pack: RegionPack,
  row: Hang & { readonly pitch: number }
): void {
  const span = shopRowSpanOf(pack.shops)

  if (span === undefined) {
    return
  }

  for (let x = span[0] + 4; x < span[1] - 6; x += row.pitch) {
    row.hang(g, { x, y: ROW_BASE_Y, index: Math.floor(x / row.pitch), dark: row.dark })
  }
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
  const spans = shopSpansOf(pack.shops).filter((span) => span.row.item !== undefined)

  for (const span of spans.filter((_, index) => index % 2 === 0)) {
    const x = span.x + Math.min(2.4, span.w * 0.2)
    const y = NORTH.farTop + 0.7

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

// Flags on the far kerb's poles, along the shop row and either side of the frontage's top.
function paintFlags(g: CanvasRenderingContext2D, pack: RegionPack, dark: number): void {
  const row = shopRowSpanOf(pack.shops)
  const stops = sheltersOf(pack).filter((shelter) => shelter.stop.side === 'far')
  const isClear = (x: number): boolean =>
    (row === undefined || x <= row[0] - FLAG_CLEAR.row || x >= row[1] + FLAG_CLEAR.row) &&
    stops.every((shelter) => Math.abs(shelter.x - x) >= FLAG_CLEAR.shelter) &&
    Math.abs(x - CROSSING.x) >= FLAG_CLEAR.crossing

  for (
    let x = Math.ceil((STREET_LEFT + 10) / KERB_FLAG_PITCH) * KERB_FLAG_PITCH;
    x < STREET_RIGHT;
    x += KERB_FLAG_PITCH
  ) {
    if (isClear(x)) {
      paintFlag(g, { x, y: KERB_Y.far + 0.1, w: 4.8, h: 3.1, dark })
    }
  }

  if (row !== undefined) {
    for (let x = row[0] + 10; x < row[1] - 8; x += ROW_FLAG_PITCH) {
      paintFlag(g, { x, y: ROW_FLAG_Y, w: 3.6, h: 2.3, dark })
    }
  }

  paintFrontageFlags(g, frontageOf(pack.shops)?.body, dark)
}

function paintFrontageFlags(
  g: CanvasRenderingContext2D,
  body: Rect | undefined,
  dark: number
): void {
  if (body === undefined) {
    return
  }

  const { drop, inset, w, h } = FRONTAGE_FLAG
  const y = body.y + drop

  paintFlag(g, { x: body.x + inset, y, w, h, dark })
  paintFlag(g, { x: body.x + body.w - inset - w, y, w, h, dark })
}

// A flag on its pole: red field, yellow star.
function paintFlag(
  g: CanvasRenderingContext2D,
  flag: {
    readonly x: number
    readonly y: number
    readonly w: number
    readonly h: number
    readonly dark: number
  }
): void {
  const { x, y, w, h, dark } = flag
  const top = y - h * 2.2

  g.fillStyle = mixTone('#8A6B3E', NIGHT_TONE, dark * 0.5)
  g.fillRect(x - 0.18, top, 0.36, h * 2.2)
  g.fillStyle = mixTone('#DA251D', NIGHT_TONE, dark * 0.4)
  g.fillRect(x + 0.18, top, w, h)
  g.fillStyle = '#FFDE00'
  g.beginPath()

  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + i * (Math.PI / 5)
    const reach = i % 2 === 0 ? h * 0.42 : h * 0.2

    g.lineTo(x + 0.18 + w / 2 + Math.cos(angle) * reach, top + h / 2 + Math.sin(angle) * reach)
  }

  g.closePath()
  g.fill()
}
