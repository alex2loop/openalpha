import type { SideStreet } from '@/web/scene/world/regions'
import {
  type CityScene,
  paintFarBand,
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
import { WORLD } from '@/web/scene/types'
import { createRng, seedOf } from '@/web/scene/world/rng'
import { NORTH, SIDE_ROAD, sideX } from '@/web/scene/world/street-layout'

// A side street, as distances out from the building's side wall: its road, far pavement, verge,
// the side park's ground up to `parkEdge` (from `parkTop` down), and the blocks beyond.
const SIDE = Object.freeze({
  road: SIDE_ROAD.from,
  farPave: SIDE_ROAD.to,
  verge: 64,
  lawn: 78,
  parkEdge: 192,
  parkTop: 34,
})
// Below the building: the plaza, the south park, the far blocks along the bottom edge.
const SOUTH = Object.freeze({ plaza: 10, park: 98, band: 34 })
const FAR_BAND_REACH = 200
const WIRE_TONES = Object.freeze({
  wire: { day: '#17191F', night: '#05070C', share: 0.3 },
  pole: { day: '#A8A8A2', night: '#242838', share: 0.7 },
  box: { day: '#7C8088', night: '#242838', share: 0.7 },
})
const POLE_GAP_PX = 70
const POLE_PX = 9.2
const CABLE_OFFSETS = [-1.8, -0.6, 0.6, 1.8] as const

type Side = -1 | 1

/** One side street from the north road to the canvas edge: its road and pavements, the verge and
 *  the side park's ground, trees and lamps, and the hazy blocks beyond the park. */
export function paintSideStreet(
  scene: CityScene,
  at: { readonly side: Side; readonly street: SideStreet }
): void {
  const { side } = at
  const out = (distance: number): number => sideX(side, distance)
  const span = (from: number, to: number): readonly [number, number] => [
    Math.min(out(from), out(to)),
    Math.abs(out(to) - out(from)),
  ]
  const top = NORTH.roadBottom

  fillTone(scene, GROUND_TONES.verge, spanRect(span(SIDE.verge, SIDE.lawn), top))
  fillTone(scene, GROUND_TONES.lawn, spanRect(span(SIDE.lawn, SIDE.parkEdge), SIDE.parkTop))
  fillTone(scene, GROUND_TONES.road, spanRect(span(SIDE.road, SIDE.farPave), top))
  fillTone(scene, GROUND_TONES.kerb, spanRect(span(SIDE.road, SIDE.road + 1.4), top))

  if (at.street.lanes > 1 && !at.street.oneWay) {
    paintSideCentreLine(scene, out((SIDE.road + SIDE.farPave) / 2))
  }

  paintSidePlanting(scene, { side, out })

  if (side > 0) {
    paintWires(scene, { near: out(SIDE.road - 3), far: out(SIDE.farPave + 3.5) })
  }

  paintFarBand(scene, {
    x0: side < 0 ? STREET_LEFT : out(SIDE.parkEdge),
    x1: side < 0 ? out(SIDE.parkEdge) : STREET_RIGHT,
    y0: SIDE.parkTop + 8,
    y1: STREET_BOTTOM + 30,
    step: 34,
    capTop: top + 2,
    seed: `band|${side}`,
    near: out(SIDE.parkEdge + FAR_BAND_REACH),
    reach: FAR_BAND_REACH,
  })
}

function spanRect(span: readonly [number, number], top: number): [number, number, number, number] {
  return [span[0], top, span[1], STREET_BOTTOM - top]
}

function paintSideCentreLine(scene: CityScene, x: number): void {
  scene.g.fillStyle = toneOf(scene, GROUND_TONES.line)

  for (let y = NORTH.roadBottom; y < STREET_BOTTOM; y += 14) {
    scene.g.fillRect(x - 0.5, y, 1, 7)
  }
}

// A hedge and trees on the near pavement, trees on the far one and the verge, lamps facing the road.
function paintSidePlanting(
  scene: CityScene,
  at: { readonly side: Side; readonly out: (distance: number) => number }
): void {
  const { g } = scene
  const { out } = at
  const top = NORTH.roadBottom
  const rng = createRng(seedOf('side', String(at.side)))

  g.fillStyle = toneOf(scene, GROUND_TONES.hedge)

  for (let y = top + 8; y < STREET_BOTTOM; y += 8) {
    g.beginPath()
    g.arc(out(9), y, 3.6, 0, Math.PI * 2)
    g.fill()
  }

  for (const [distance, from, gap] of [
    [18, 30, 44],
    [SIDE.farPave + 6, 14, 60],
    [SIDE.lawn - 4, 26, 52],
  ] as const) {
    for (let y = top + from; y < STREET_BOTTOM; y += gap + rng.next() * 14) {
      paintTree(scene, { x: out(distance), y }, rng.int(0, 2))
    }
  }

  for (let y = top + 50; y < STREET_BOTTOM; y += 72) {
    paintLamp(scene, { x: out(SIDE.road - 3), y }, at.side < 0 ? 1 : -1)
  }
}

// Concrete poles on both pavements every `POLE_GAP_PX`, cable bundles sagging between the far
// poles' tops and across the road, a knot of loose strands and now and then a transformer box.
function paintWires(scene: CityScene, at: { readonly near: number; readonly far: number }): void {
  const { g } = scene
  const poles: number[] = []

  for (let y = NORTH.roadBottom + 30; y < STREET_BOTTOM; y += POLE_GAP_PX) {
    poles.push(y)
  }

  for (const [index, y] of poles.entries()) {
    paintPole(scene, { x: at.far, y, hasBox: index % 3 === 0 })

    if (index % 2 === 0) {
      paintPole(scene, { x: at.near, y, hasBox: false })
    }
  }

  g.strokeStyle = toneOf(scene, WIRE_TONES.wire)
  g.lineWidth = 0.3
  g.lineCap = 'round'

  for (const [index, y] of poles.entries()) {
    const next = poles[index + 1]

    if (next !== undefined) {
      paintSpan(g, { x: at.far, from: y - POLE_PX + 1, to: next - POLE_PX + 1 })
    }

    if (index % 2 === 0) {
      paintCrossing(scene, { near: at.near, far: at.far, y: y - POLE_PX + 1 })
    }
  }
}

function paintPole(
  scene: CityScene,
  at: { readonly x: number; readonly y: number; readonly hasBox: boolean }
): void {
  fillTone(scene, WIRE_TONES.pole, [at.x - 0.55, at.y - POLE_PX, 1.1, POLE_PX])
  fillTone(scene, WIRE_TONES.pole, [at.x - 2.2, at.y - POLE_PX + 1, 4.4, 0.5])

  if (at.hasBox) {
    fillTone(scene, WIRE_TONES.box, [at.x - 1.2, at.y - POLE_PX + 2.4, 2.4, 2.8])
  }
}

// The bundle down the far pavement from one pole top to the next, each cable sagging its own way.
function paintSpan(
  g: CanvasRenderingContext2D,
  at: { readonly x: number; readonly from: number; readonly to: number }
): void {
  for (const offset of CABLE_OFFSETS) {
    const sag = 1.2 + offset * offset * 0.15

    g.beginPath()
    g.moveTo(at.x + offset * 0.9, at.from + offset * 0.15)
    g.quadraticCurveTo(
      at.x + offset * 0.9,
      (at.from + at.to) / 2 + sag * 2.2,
      at.x + offset * 0.9,
      at.to + offset * 0.15
    )
    g.stroke()
  }
}

// Cables across the road to the near pole, and the knot of loose strands at the far pole; the
// strands only close up.
function paintCrossing(
  scene: CityScene,
  at: { readonly near: number; readonly far: number; readonly y: number }
): void {
  const { g } = scene

  for (const offset of [-1, 0, 1]) {
    g.beginPath()
    g.moveTo(at.far + offset * 0.9, at.y)
    g.quadraticCurveTo(
      (at.near + at.far) / 2,
      at.y + 2.6 + offset * 0.4,
      at.near + offset * 1.2,
      at.y + offset * 0.2
    )
    g.stroke()
  }

  g.fillStyle = toneOf(scene, WIRE_TONES.wire)
  g.beginPath()
  g.ellipse(at.far, at.y + 0.4, 1.5, 0.9, 0, 0, Math.PI * 2)
  g.fill()

  if (scene.minute.detail < 2) {
    return
  }

  for (const [dx, dy] of [
    [-2.4, 2.2],
    [2.2, 2.8],
    [0.4, 3.4],
  ] as const) {
    g.beginPath()
    g.moveTo(at.far, at.y + 0.4)
    g.quadraticCurveTo(at.far + dx * 0.6, at.y + 0.4 + dy * 1.2, at.far + dx, at.y + 0.4 + dy)
    g.stroke()
  }
}

/** The plaza under the building's front with its trees and lamps, the south park's ground, and
 *  the far blocks along the bottom edge. */
export function paintSouth(scene: CityScene): void {
  const parkTop = WORLD.h + SOUTH.park
  const rng = createRng(seedOf('south'))

  fillTone(scene, GROUND_TONES.lawn, [0, parkTop, WORLD.w, STREET_BOTTOM - parkTop])

  for (let x = 26; x < WORLD.w; x += 64) {
    paintTree(scene, { x, y: WORLD.h + SOUTH.plaza + 24 }, rng.int(0, 2))
  }

  for (let x = 58; x < WORLD.w; x += 128) {
    paintLamp(scene, { x, y: WORLD.h + SOUTH.plaza + 20 }, 1)
  }

  paintFarBand(scene, {
    x0: 0,
    x1: WORLD.w,
    y0: STREET_BOTTOM - SOUTH.band,
    y1: STREET_BOTTOM - 4,
    step: 30,
    capTop: STREET_BOTTOM - 2 * SOUTH.band,
    seed: 'band|south',
    near: WORLD.w / 2,
    reach: 2 * FAR_BAND_REACH,
  })
}
