import type { RegionPack } from '@/web/scene/world/regions'
import { type ShopSpan, shopRowSpanOf, shopSpansOf } from '@/web/scene/world/frontage'
import { FAR_TREES, NORTH } from '@/web/scene/world/street-layout'

const STRING_Y = -26.4
const STRING_SAG = 2.4
const STRING_REACH = 72
const STRING_STEPS = 12
const STRING_PER_PX = 6
const ROW_EDGE = 12
const ROW_BASE_Y = NORTH.farTop - 0.6
/** The y a festive pot or pumpkin stands at, before a dressed shop. */
export const DRESSED_FOOT_Y = NORTH.farTop + 0.7

/** Where an ornament hangs, which one it is along its string or row, and how dark it is. */
export interface HangAt {
  readonly x: number
  readonly y: number
  readonly index: number
  readonly dark: number
}

interface Hang {
  readonly dark: number
  readonly hang: (g: CanvasRenderingContext2D, at: HangAt) => void
}

interface Garland extends Hang {
  readonly pitch: number
}

/** Every other shop that sells something: the ones a festive pot or pumpkin stands before. */
export function dressedShopsOf(pack: RegionPack): readonly ShopSpan[] {
  return shopSpansOf(pack.shops)
    .filter((span) => span.row.item !== undefined)
    .filter((_, index) => index % 2 === 0)
}

/** A garland: strings of ornaments sagging between the far trees and a row of them, `pitch` apart,
 *  along the top of the shop row. */
export function paintGarland(
  g: CanvasRenderingContext2D,
  pack: RegionPack,
  garland: Garland
): void {
  paintStrings(g, pack, garland)
  paintRow(g, pack, garland)
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

// Ornaments hung along the top of the shop row.
function paintRow(g: CanvasRenderingContext2D, pack: RegionPack, row: Garland): void {
  const span = shopRowSpanOf(pack.shops)

  if (span === undefined) {
    return
  }

  for (let x = span[0] + 4; x < span[1] - 6; x += row.pitch) {
    row.hang(g, { x, y: ROW_BASE_Y, index: Math.floor(x / row.pitch), dark: row.dark })
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
