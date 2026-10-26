import type { PaintPart, StreetMinute } from '@/web/scene/render2d/street/paint'
import type { RegionPack, RoadLayout } from '@/web/scene/world/regions'
import {
  type CityScene,
  paintBlock,
  paintLamp,
  paintTree,
} from '@/web/scene/render2d/street/city-blocks'
import {
  fillTone,
  GROUND_TONES,
  STREET_BOTTOM,
  STREET_LEFT,
  STREET_RIGHT,
  toneOf,
} from '@/web/scene/render2d/street/city-ground'
import { paintSideStreet, paintSouth } from '@/web/scene/render2d/street/city-sides'
import { paintBackdrop } from '@/web/scene/render2d/street/landmark'
import { mixTone } from '@/web/scene/render2d/street/tone'
import { WORLD } from '@/web/scene/types'
import { STREET_RECT } from '@/web/scene/view'
import { shopRowSpanOf } from '@/web/scene/world/frontage'
import { holidayOf, isWithin } from '@/web/scene/world/regions'
import { createRng, seedOf } from '@/web/scene/world/rng'
import { FAR_TREE_Y, FAR_TREES, METRES_PER_PX, NORTH } from '@/web/scene/world/street-layout'
import { MINUTES_PER_DAY } from '@/web/text/time-units'

const TILE_PX = 0.4 / METRES_PER_PX
// The skyline north of the street, far row first: base line, roof depth, facade height and width
// ranges, its tone, how far it leans to the horizon and the share of the lit curve it follows.
const SKYLINE = [
  { base: -60, depth: 22, height: [15, 29], width: [14, 26], tone: '#9AACC4', haze: 0.5, lit: 0.5 },
  { base: -46, depth: 20, height: [17, 34], width: [16, 30], tone: '#7D90AA', haze: 0.3, lit: 0.8 },
  { base: -32, depth: 16, height: [20, 38], width: [18, 34], tone: '#5C6A84', haze: 0.1, lit: 1 },
] as const
const POCKET_PARK_SHARE = 0.14
const STAR_COUNT = 46
const STARS_FROM_DARK = 0.35
const STAR_FADE = 0.3
const TONES = Object.freeze({
  median: { day: '#C8332D', night: '#6A6E80', share: 0.5 },
  tactile: { day: '#B6A878', night: '#2A2A3A', share: 0.6 },
  tactileDot: { day: '#9C8E60', night: '#2A2A3A', share: 0.6 },
})
const TILE_JOINT = 'rgba(70,62,52,.075)'
const STAR = '#FFFFFF'

/** The city itself: the sky and skyline, the north road, both side streets out to the canvas
 *  edge, the plaza south of the building, and the hazy blocks beyond the parks. */
export const CITY_PART: PaintPart = {
  paintStatic: (g, pack, minute) => {
    const scene = citySceneOf(g, pack, minute)

    paintSky(scene, minute.light.sky)
    paintBackdrop(scene, pack)
    paintSkyline(scene)
    paintNorthStreet(scene, pack)
    paintSideStreet(scene, { side: -1, street: pack.road.west })
    paintSideStreet(scene, { side: 1, street: pack.road.east })
    paintSouth(scene)
  },
}

/** What the city painters read at `minute`: its darkness, lit windows, horizon and holiday. */
export function citySceneOf(
  g: CanvasRenderingContext2D,
  pack: RegionPack,
  minute: StreetMinute
): CityScene {
  return {
    g,
    minute,
    dark: minute.light.dark,
    lit: litShareOf(pack, minute.minute) * minute.light.dark,
    isBalconyHour: isWithin(pack.hours.balconies, minute.minute),
    horizon: minute.light.sky[1],
    holiday: holidayOf(pack, minute.day),
  }
}

/** The share of a street building's windows lit at `minute` of the day. */
export function litShareOf(pack: RegionPack, minute: number): number {
  const curve = pack.hours.windowsLit
  const at = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const next = curve.findIndex(([from]) => from > at)
  const [a0, a1] = curve[next - 1] ?? [0, 0]
  const [b0, b1] = curve[next] ?? [a0, a1]

  return b0 === a0 ? a1 : a1 + ((b1 - a1) * (at - a0)) / (b0 - a0)
}

// The sky down to the far pavement, the stars after dark, then the ground under everything south.
function paintSky(scene: CityScene, sky: readonly [string, string]): void {
  const { g, dark } = scene
  const gradient = g.createLinearGradient(0, STREET_RECT.y, 0, NORTH.farTop)

  gradient.addColorStop(0, sky[0])
  gradient.addColorStop(1, sky[1])
  g.fillStyle = gradient
  g.fillRect(STREET_LEFT, STREET_RECT.y, STREET_RECT.w, NORTH.farTop - STREET_RECT.y)
  fillTone(scene, GROUND_TONES.pave, [
    STREET_LEFT,
    NORTH.farTop,
    STREET_RECT.w,
    STREET_BOTTOM - NORTH.farTop,
  ])

  if (dark <= STARS_FROM_DARK) {
    return
  }

  const rng = createRng(seedOf('stars'))
  const skyH = (NORTH.farTop - STREET_RECT.y) / 2

  g.fillStyle = STAR

  for (let i = 0; i < STAR_COUNT; i++) {
    const x = STREET_LEFT + rng.next() * STREET_RECT.w
    const y = STREET_RECT.y + rng.next() * skyH

    g.globalAlpha = (dark - STAR_FADE) * (0.4 + rng.next() * 0.6)
    g.fillRect(x, y, 1.2, 1.2)
  }

  g.globalAlpha = 1
}

// Three hazy rows of low blocks, far to near, with a small park in a gap now and then.
function paintSkyline(scene: CityScene): void {
  for (const [row, layer] of SKYLINE.entries()) {
    const rng = createRng(seedOf('skyline', String(row)))
    const tone = mixTone(layer.tone, scene.horizon, layer.haze)

    for (let x = STREET_LEFT - 8, index = 0; x < STREET_RIGHT; index++) {
      const w = layer.width[0] + rng.next() * (layer.width[1] - layer.width[0])
      const height = layer.height[0] + rng.next() * (layer.height[1] - layer.height[0])
      const isPocketPark = row > 0 && index > 0 && rng.next() < POCKET_PARK_SHARE

      if (isPocketPark) {
        fillTone(scene, GROUND_TONES.lawn, [x, layer.base - layer.depth, w, layer.depth])
        paintTree(scene, { x: x + w * 0.3, y: layer.base - 1 }, index)
        paintTree(scene, { x: x + w * 0.7, y: layer.base - 4 }, index + 1)
      } else {
        const seed = seedOf('block', String(row), String(index))

        paintBlock(scene, {
          x,
          base: layer.base,
          w,
          depth: layer.depth,
          height,
          tone,
          lit: layer.lit,
          seed,
        })
      }

      x += w + 1 + rng.next() * 3
    }
  }
}

function paintNorthStreet(scene: CityScene, pack: RegionPack): void {
  const { road } = pack
  const row = shopRowSpanOf(pack.shops)

  paintFarPavement(scene)
  fillTone(scene, GROUND_TONES.road, [
    STREET_LEFT,
    NORTH.roadTop,
    STREET_RECT.w,
    NORTH.roadBottom - NORTH.roadTop,
  ])
  fillTone(scene, GROUND_TONES.kerb, [STREET_LEFT, NORTH.roadTop - 1, STREET_RECT.w, 1])
  fillTone(scene, GROUND_TONES.kerb, [STREET_LEFT, NORTH.roadBottom, STREET_RECT.w, 1.4])
  paintRoadMarks(scene, road.north)

  for (const tree of FAR_TREES) {
    if (row === undefined || tree.x < row[0] || tree.x > row[1]) {
      paintTree(scene, { x: tree.x, y: FAR_TREE_Y }, tree.kind)
    }
  }

  paintFront(scene)
}

// The far pavement's 0.4 m granite tiles and the tactile strip down its middle; the joints and
// the strip's studs only close up.
function paintFarPavement(scene: CityScene): void {
  const { g } = scene
  const { farTop, roadTop } = NORTH
  const mid = (farTop + roadTop) / 2
  const detail = scene.minute.detail

  if (detail === 2) {
    g.fillStyle = TILE_JOINT

    for (let x = Math.ceil(STREET_LEFT / TILE_PX) * TILE_PX; x < STREET_RIGHT; x += TILE_PX) {
      g.fillRect(x, farTop, 0.18, roadTop - farTop)
    }

    for (let y = farTop + TILE_PX; y < roadTop; y += TILE_PX) {
      g.fillRect(STREET_LEFT, y, STREET_RECT.w, 0.18)
    }
  }

  fillTone(scene, TONES.tactile, [STREET_LEFT, mid - 0.45, STREET_RECT.w, 0.9])

  if (detail === 2) {
    g.fillStyle = toneOf(scene, TONES.tactileDot)

    for (let x = STREET_LEFT; x < STREET_RIGHT; x += 1.6) {
      g.fillRect(x, mid - 0.45, 0.5, 0.9)
    }
  }
}

// The median with its red and white kerb bands, or a centre line; then the lane lines.
function paintRoadMarks(scene: CityScene, north: RoadLayout['north']): void {
  const { roadTop, roadBottom } = NORTH
  const mid = (roadTop + roadBottom) / 2

  if (north.median) {
    for (let x = Math.floor(STREET_LEFT / 3) * 3, band = 0; x < STREET_RIGHT; x += 3, band++) {
      fillTone(scene, band % 2 === 0 ? TONES.median : GROUND_TONES.line, [x, mid - 0.5, 3, 1])
    }
  } else if (north.carriageways === 2) {
    paintDashes(scene, { y: mid - 0.5, h: 1, dash: 7, gap: 7 })
  }

  if (scene.minute.detail === 0) {
    return
  }

  const span = (roadBottom - roadTop) / north.carriageways

  for (let carriageway = 0; carriageway < north.carriageways; carriageway++) {
    for (let lane = 1; lane < north.lanesEach; lane++) {
      const y = roadTop + carriageway * span + (lane * span) / north.lanesEach

      paintDashes(scene, { y: y - 0.15, h: 0.3, dash: 4, gap: 6 })
    }
  }
}

function paintDashes(
  scene: CityScene,
  dashes: { readonly y: number; readonly h: number; readonly dash: number; readonly gap: number }
): void {
  scene.g.fillStyle = toneOf(scene, GROUND_TONES.line)

  for (let x = STREET_LEFT; x < STREET_RIGHT; x += dashes.dash + dashes.gap) {
    scene.g.fillRect(x, dashes.y, dashes.dash, dashes.h)
  }
}

// The near pavement along the building's north glass: a hedge, trees and lamps.
function paintFront(scene: CityScene): void {
  const { g } = scene
  const rng = createRng(seedOf('front'))

  g.fillStyle = toneOf(scene, GROUND_TONES.hedge)

  for (let x = 0; x < WORLD.w; x += 8) {
    g.beginPath()
    g.arc(x + 4, 25, 4.4, 0, Math.PI * 2)
    g.fill()
  }

  for (let x = 20; x < WORLD.w; x += 56 + rng.next() * 16) {
    paintTree(scene, { x, y: 23 }, rng.int(0, 2))
  }

  for (let x = 34; x < WORLD.w; x += 72) {
    paintLamp(scene, { x, y: 13 }, 1)
  }
}
