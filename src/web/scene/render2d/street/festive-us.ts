import type { RegionPack } from '@/web/scene/world/regions'
import {
  DRESSED_FOOT_Y,
  dressedShopsOf,
  type HangAt,
  paintGarland,
} from '@/web/scene/render2d/street/festive-dress'
import { paintFlags, paintUsFlag } from '@/web/scene/render2d/street/festive-flags'
import { mixTone, NIGHT_TONE } from '@/web/scene/render2d/street/tone'

const BUNTING = ['#B22234', '#F4F1E8', '#3C3B6E'] as const
const BUNTING_PITCH = 5
const PENNANT = Object.freeze({ half: 0.8, drop: 1.8, night: 0.35 })
const LEAVES = ['#D9822B', '#B8502A', '#C9A227', '#7A4A2A'] as const
const LEAF_PITCH = 4
const LEAF = Object.freeze({ rx: 0.45, ry: 0.85, lift: 0.5, tilt: 0.5, night: 0.35 })
const PUMPKIN = Object.freeze({
  skin: '#E07B1F',
  groove: '#C9651A',
  stem: '#4F8A3C',
  dark: '#2A1A18',
  stemDark: '#1E3A2C',
  skinNight: 0.5,
  stemNight: 0.6,
  lean: 0.32,
  rx: 1.5,
  ry: 1.2,
  // The groove and the stem start this far left of the pumpkin's centre.
  inset: 0.2,
  grooveTop: 1.6,
  grooveW: 0.4,
  grooveH: 1.2,
  stemTop: 2.7,
  stemW: 0.5,
  stemH: 0.7,
})

/** The street on the Fourth of July: red, white and blue bunting between the trees and along the
 *  shop row, US flags on the far kerb's poles, the shop row and the frontage. */
export function paintJul4(g: CanvasRenderingContext2D, pack: RegionPack, dark: number): void {
  paintGarland(g, pack, { dark, hang: pennant, pitch: BUNTING_PITCH })
  paintFlags(g, pack, { dark, paint: paintUsFlag })
}

/** The street at Thanksgiving: garlands of autumn leaves between the trees and along the shop row,
 *  a pumpkin before every other shop that sells something. */
export function paintThanksgiving(
  g: CanvasRenderingContext2D,
  pack: RegionPack,
  dark: number
): void {
  paintGarland(g, pack, { dark, hang: leaf, pitch: LEAF_PITCH })
  paintPumpkins(g, pack, dark)
}

function pennant(g: CanvasRenderingContext2D, at: HangAt): void {
  g.fillStyle = tintOf(BUNTING, at, PENNANT.night)
  g.beginPath()
  g.moveTo(at.x - PENNANT.half, at.y)
  g.lineTo(at.x + PENNANT.half, at.y)
  g.lineTo(at.x, at.y + PENNANT.drop)
  g.closePath()
  g.fill()
}

function leaf(g: CanvasRenderingContext2D, at: HangAt): void {
  const tilt = at.index % 2 === 0 ? LEAF.tilt : -LEAF.tilt

  g.fillStyle = tintOf(LEAVES, at, LEAF.night)
  g.beginPath()
  g.ellipse(at.x, at.y + LEAF.lift, LEAF.rx, LEAF.ry, tilt, 0, Math.PI * 2)
  g.fill()
}

// The palette's colour for the ornament at `at`, taking `night` of the darkness.
function tintOf(palette: readonly [string, ...string[]], at: HangAt, night: number): string {
  return mixTone(palette[at.index % palette.length] ?? palette[0], NIGHT_TONE, at.dark * night)
}

function paintPumpkins(g: CanvasRenderingContext2D, pack: RegionPack, dark: number): void {
  for (const span of dressedShopsOf(pack)) {
    const x = span.x + span.w * PUMPKIN.lean

    g.fillStyle = mixTone(PUMPKIN.skin, PUMPKIN.dark, dark * PUMPKIN.skinNight)
    g.beginPath()
    g.ellipse(x, DRESSED_FOOT_Y - PUMPKIN.ry, PUMPKIN.rx, PUMPKIN.ry, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = mixTone(PUMPKIN.groove, PUMPKIN.dark, dark * PUMPKIN.skinNight)
    g.fillRect(
      x - PUMPKIN.inset,
      DRESSED_FOOT_Y - PUMPKIN.grooveTop,
      PUMPKIN.grooveW,
      PUMPKIN.grooveH
    )
    g.fillStyle = mixTone(PUMPKIN.stem, PUMPKIN.stemDark, dark * PUMPKIN.stemNight)
    g.fillRect(x - PUMPKIN.inset, DRESSED_FOOT_Y - PUMPKIN.stemTop, PUMPKIN.stemW, PUMPKIN.stemH)
  }
}
