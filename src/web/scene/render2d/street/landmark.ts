import type { CityScene } from '@/web/scene/render2d/street/city-blocks'
import type { RegionPack } from '@/web/scene/world/regions'
import { paintCityBack } from '@/web/scene/render2d/street/city-back'
import { paintCrown, paintPodium } from '@/web/scene/render2d/street/landmark-parts'
import {
  BAND_Y,
  DESIGN,
  halfWidthAt,
  nightTone,
  ROOF_Y,
  seamAt,
  TIP_Y,
  type TowerPaint,
} from '@/web/scene/render2d/street/landmark-shape'
import { isNightDark, mixTone } from '@/web/scene/render2d/street/tone'
import { STREET_RECT } from '@/web/scene/view'
import { isLightsOut } from '@/web/scene/world/frontage'
import { createRng, seedOf } from '@/web/scene/world/rng'

const ROW_STEP = 3
const GLASS = Object.freeze({ body: '#7C9CC6', shade: '#2B4675' })
const FLOOR_LIT = ['#FFE6A8', '#FFD27A'] as const
const HALF = DESIGN.shaftHalfW + 1
const EDGE_WIDTH = HALF * 2
const MULLIONS = 34
const MULLION_LED_EVERY = 4

/** The city behind the street: the city's back rows while the camera shows the sky above the
 *  framed view, the landmark tower in front of them and its podium at its foot, painted right
 *  after the sky and behind every building row. The tower is drawn in its design frame, scaled
 *  about its foot, moved to the pack's `landmark.foot` and hazed by its distance. */
export function paintBackdrop(scene: CityScene, pack: RegionPack): void {
  const { g, minute, dark, lit } = scene
  const { foot, scale, haze } = pack.landmark
  const tower: TowerPaint = {
    g,
    dark,
    lit,
    haze,
    sky: minute.light.sky,
    isNight: isNightDark(dark),
    isLobbyLit: isNightDark(dark) && !isLightsOut(pack, minute.minute),
  }

  // As the mockup: the default framing shows only the low skyline; once the sky above it shows,
  // the back rows run whole down to the far pavement, behind the low rows.
  if (minute.isRevealed) {
    paintCityBack(scene, foot.x)
  }

  g.save()
  g.translate(foot.x, foot.y)
  g.scale(scale, scale)
  paintShaft(tower, (STREET_RECT.y - foot.y) / scale)
  paintCrown(tower)
  paintPodium(tower)
  g.restore()
}

// The shaft from the podium's roof up to design row `top`: clipped to its swelling outline, then
// its glass, floors, mullions, recessed band and petal seam.
function paintShaft(t: TowerPaint, top: number): void {
  const ys = rowsOf(top)

  if (ys.length < 2) {
    return
  }

  const { g } = t

  g.save()
  clipShaft(g, ys)
  paintGlass(t, ys)
  paintFloors(t, ys)
  paintMullions(t, ys)
  paintBand(t)
  paintSeam(t, ys)
  paintRoofShade(t)
  g.restore()
}

// The sampled rows, from just under the roof upward.
function rowsOf(top: number): number[] {
  const rows: number[] = []

  for (let y = ROOF_Y + 1; y >= Math.max(TIP_Y, top - ROW_STEP); y -= ROW_STEP) {
    rows.push(y)
  }

  return rows
}

function clipShaft(g: CanvasRenderingContext2D, ys: readonly number[]): void {
  g.beginPath()
  g.moveTo(-halfWidthAt(ys[0] ?? 0), ys[0] ?? 0)

  for (const y of ys) {
    g.lineTo(-halfWidthAt(y), y)
  }

  for (const y of ys.toReversed()) {
    g.lineTo(halfWidthAt(y), y)
  }

  g.closePath()
  g.clip()
}

// A round shaft: a dark edge, a sun streak a third in, the sky's reflection over it.
function paintGlass(t: TowerPaint, ys: readonly number[]): void {
  const { g } = t
  const sb = t.sky[1]
  const glass = mixTone(GLASS.body, sb, t.haze)
  const hi = mixTone(glass, '#FFFFFF', 0.55)
  const lo = mixTone(GLASS.shade, sb, t.haze - 0.04)
  const mid = mixTone(glass, lo, 0.5)
  const y0 = (ys.at(-1) ?? 0) - 2
  const y1 = (ys[0] ?? 0) + 1
  const across = g.createLinearGradient(-DESIGN.shaftHalfW, 0, DESIGN.shaftHalfW, 0)

  across.addColorStop(0, nightTone(t, lo, 0.82))
  across.addColorStop(0.1, nightTone(t, mixTone(lo, glass, 0.4), 0.8))
  across.addColorStop(0.26, nightTone(t, mixTone(glass, hi, 0.55), 0.78))
  across.addColorStop(0.33, nightTone(t, mixTone(hi, '#FFFFFF', 0.35), 0.76))
  across.addColorStop(0.42, nightTone(t, mixTone(hi, glass, 0.5), 0.78))
  across.addColorStop(0.64, nightTone(t, glass, 0.8))
  across.addColorStop(0.88, nightTone(t, mid, 0.82))
  across.addColorStop(1, nightTone(t, lo, 0.84))
  g.fillStyle = across
  g.fillRect(-HALF, y0, EDGE_WIDTH, y1 - y0)

  const down = g.createLinearGradient(0, TIP_Y, 0, ROOF_Y)

  down.addColorStop(0, t.sky[0])
  down.addColorStop(1, sb)
  g.globalAlpha = 0.16 * (1 - t.dark)
  g.fillStyle = down
  g.fillRect(-HALF, y0, EDGE_WIDTH, y1 - y0)
  g.globalAlpha = 1
}

// The two petals' floors: the right petal overlaps the left, so the left face is shaded and its
// floors sit half a floor lower.
function paintFloors(t: TowerPaint, ys: readonly number[]): void {
  const { g } = t
  const y0 = (ys.at(-1) ?? 0) - 2
  const y1 = (ys[0] ?? 0) + 1

  g.save()
  g.beginPath()
  g.moveTo(-halfWidthAt(ys[0] ?? 0) - 3, (ys[0] ?? 0) + 1)

  for (const y of ys) {
    g.lineTo(-halfWidthAt(y) - 3, y)
  }

  for (const y of ys.toReversed()) {
    g.lineTo(seamAt(y), y)
  }

  g.closePath()
  g.clip()
  g.fillStyle = 'rgba(18,34,62,.17)'
  g.fillRect(-HALF, y0, EDGE_WIDTH, y1 - y0)
  paintFloorRows(t, { phase: 4, y0, y1 })
  g.restore()

  g.save()
  g.beginPath()
  g.moveTo(seamAt(ys[0] ?? 0), (ys[0] ?? 0) + 1)

  for (const y of ys) {
    g.lineTo(seamAt(y), y)
  }

  for (const y of ys.toReversed()) {
    g.lineTo(halfWidthAt(y) + 3, y)
  }

  g.closePath()
  g.clip()
  paintFloorRows(t, { phase: 0, y0, y1 })
  g.restore()
}

// One petal's floors: a thin dark line and a lighter glass strip every floor; after dusk some
// floors are lit.
function paintFloorRows(
  t: TowerPaint,
  at: { readonly phase: number; readonly y0: number; readonly y1: number }
): void {
  const { g } = t
  const share = t.isNight ? t.lit : 0
  const rng = createRng(seedOf('tower-floors', String(at.phase)))

  for (let y = ROOF_Y - 7 - at.phase; y > TIP_Y - DESIGN.floor; y -= DESIGN.floor) {
    const lights = rng.next()
    const left = rng.next()
    const span = rng.next()
    const tone = rng.next()

    if (y < at.y0 - 9 || y > at.y1 + 9) {
      continue
    }

    const half = halfWidthAt(y)

    if (lights < share) {
      g.globalAlpha = 0.66
      g.fillStyle = tone > 0.5 ? FLOOR_LIT[0] : FLOOR_LIT[1]
      g.fillRect(-half + left * half * 0.8, y + 2.2, half * (0.4 + span * 1.1), 3.6)
      g.globalAlpha = 1
    }

    g.fillStyle = `rgba(236,243,250,${(0.34 * (1 - t.dark * 0.65)).toFixed(2)})`
    g.fillRect(-HALF, y + 0.9, EDGE_WIDTH, 1.3)
    g.fillStyle = `rgba(24,40,68,${(0.3 + t.dark * 0.1).toFixed(2)})`
    g.fillRect(-HALF, y, EDGE_WIDTH, 0.8)
  }
}

// Fine mullions follow the round shaft and bunch toward its edges; after dusk every fourth is a
// line of lights.
function paintMullions(t: TowerPaint, ys: readonly number[]): void {
  const { g } = t

  g.lineWidth = 0.4

  for (let i = 1; i < MULLIONS; i++) {
    const f = Math.sin(((i / MULLIONS) * 2 - 1) * (Math.PI / 2))

    g.strokeStyle =
      i % 2 === 0
        ? 'rgba(22,38,66,.12)'
        : `rgba(238,245,252,${(0.2 * (1 - t.dark * 0.7)).toFixed(3)})`
    strokeLine(g, ys, f)
  }

  if (!t.isNight) {
    return
  }

  const alpha = Math.min(1, t.dark * 1.2)

  g.setLineDash([0.8, 1.6])
  g.lineWidth = 0.9
  g.strokeStyle = '#DCE8FF'
  g.globalAlpha = alpha * 0.85

  for (let i = MULLION_LED_EVERY - 1; i < MULLIONS; i += MULLION_LED_EVERY) {
    strokeLine(g, ys, Math.sin(((i / MULLIONS) * 2 - 1) * (Math.PI / 2)))
  }

  g.setLineDash([])
  g.globalAlpha = 1
}

function strokeLine(g: CanvasRenderingContext2D, ys: readonly number[], f: number): void {
  g.beginPath()

  for (const [index, y] of ys.entries()) {
    if (index === 0) {
      g.moveTo(halfWidthAt(y) * f, y)
    } else {
      g.lineTo(halfWidthAt(y) * f, y)
    }
  }

  g.stroke()
}

// The recessed band that wraps the shaft in its lower third.
function paintBand(t: TowerPaint): void {
  const { g } = t
  const h = DESIGN.bandH
  const haze = (1 - t.dark * 0.65).toFixed(2)

  g.beginPath()
  g.moveTo(-54, BAND_Y)
  g.quadraticCurveTo(0, BAND_Y + 3, 54, BAND_Y)
  g.lineTo(54, BAND_Y + h)
  g.quadraticCurveTo(0, BAND_Y + h + 3, -54, BAND_Y + h)
  g.closePath()
  g.fillStyle = `rgba(10,22,42,${(0.58 + t.dark * 0.2).toFixed(2)})`
  g.fill()

  const shade = g.createLinearGradient(0, BAND_Y, 0, BAND_Y + 5)

  shade.addColorStop(0, 'rgba(4,10,22,.55)')
  shade.addColorStop(1, 'rgba(4,10,22,0)')
  g.fillStyle = shade
  g.fillRect(-54, BAND_Y, 108, 5)
  g.lineWidth = 1.1
  g.strokeStyle = `rgba(236,243,250,${(0.62 * Number(haze)).toFixed(2)})`
  g.beginPath()
  g.moveTo(-54, BAND_Y - 0.6)
  g.quadraticCurveTo(0, BAND_Y + 2.4, 54, BAND_Y - 0.6)
  g.stroke()
  g.lineWidth = 0.8
  g.strokeStyle = `rgba(200,218,240,${(0.34 * Number(haze)).toFixed(2)})`
  g.beginPath()
  g.moveTo(-54, BAND_Y + h + 0.4)
  g.quadraticCurveTo(0, BAND_Y + h + 3.4, 54, BAND_Y + h + 0.4)
  g.stroke()
}

// The seam where the petals meet: a shadow, a bright edge and, after dusk, a line of light.
function paintSeam(t: TowerPaint, ys: readonly number[]): void {
  const { g } = t

  g.save()
  g.translate(-1.4, 0)
  traceSeam(g, ys)
  g.strokeStyle = nightTone(t, '#0F1D33', 0.5)
  g.globalAlpha = 0.55
  g.lineWidth = 2.4
  g.stroke()
  g.restore()

  g.save()
  g.translate(0.7, 0)
  traceSeam(g, ys)
  g.strokeStyle = `rgba(226,236,247,${(0.8 * (1 - t.dark * 0.65)).toFixed(2)})`
  g.lineWidth = 0.8
  g.stroke()
  g.restore()

  if (t.isNight) {
    const a = Math.min(1, t.dark * 1.2)

    traceSeam(g, ys)
    g.strokeStyle = '#8EC8FF'
    g.globalAlpha = 0.2 * a
    g.lineWidth = 3
    g.stroke()
    g.globalAlpha = 0.9 * a
    g.lineWidth = 0.9
    g.stroke()
    g.globalAlpha = 1
  }
}

function traceSeam(g: CanvasRenderingContext2D, ys: readonly number[]): void {
  g.beginPath()

  for (const [index, y] of ys.entries()) {
    if (index === 0) {
      g.moveTo(seamAt(y), y)
    } else {
      g.lineTo(seamAt(y), y)
    }
  }
}

// A soft shade where the shaft meets the podium's roof.
function paintRoofShade(t: TowerPaint): void {
  const { g } = t
  const shade = g.createLinearGradient(0, ROOF_Y - 9, 0, ROOF_Y + 1)

  shade.addColorStop(0, 'rgba(14,26,48,0)')
  shade.addColorStop(1, `rgba(14,26,48,${(0.22 + t.dark * 0.1).toFixed(2)})`)
  g.fillStyle = shade
  g.fillRect(-HALF, ROOF_Y - 9, EDGE_WIDTH, 10)
}
