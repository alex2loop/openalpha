import type { CityScene } from '@/web/scene/render2d/street/city-blocks'
import type { Park } from '@/web/scene/sim/street/park-layout'
import { paintLamp, paintTree } from '@/web/scene/render2d/street/city-blocks'
import { paintPond } from '@/web/scene/render2d/street/park-pond'
import {
  paintBench,
  paintGymMachine,
  paintHedgeRail,
  paintPaths,
  paintSign,
  shadeOf,
} from '@/web/scene/render2d/street/park-props'
import {
  GYM_MACHINES,
  PARK_FEATURES,
  PARKS,
  parkX,
  SIDE_PARK,
  SIDE_RINGS,
  SOUTH_PARK,
} from '@/web/scene/sim/street/park-layout'
import { WORLD } from '@/web/scene/types'
import { STREET_BOTTOM } from '@/web/scene/view'
import { createRng, seedOf } from '@/web/scene/world/rng'
import { tr } from '@/web/text/tr'

type Side = -1 | 1

const SIDE_LAMPS = Object.freeze({ u: 22, ys: [92, 196, 272, 382, 498, 602] })
const SOUTH_LAMPS = Object.freeze({ xs: [90, 250, 390, 550], dy: -6 })
const PAD = Object.freeze({ floor: '#B5654F', edge: '#8FA4B8', edgeW: 0.7 })
const PLAZA = Object.freeze({ stone: '#E0DACA', inner: '#CFC8B5', squash: 0.84, inset: 3 })
const BED = Object.freeze({
  soil: '#8A6B52',
  green: '#6FB07E',
  flowers: ['#F27C9B', '#F6D55C', '#FFFFFF', '#B089E0', '#F29A4A'],
  count: 22,
  turn: 2.399,
})
// Trees scattered over each park's far half, clear of its rings and of each other.
const SCATTER = Object.freeze({
  side: { count: 12, u0: 50, inset: 8, top: 36 },
  south: { count: 9, inset: 14, below: 28, above: 60 },
  tries: 300,
  apart: 14,
  ringPad: 8,
  kinds: 3,
})
const HEDGE_IN = 1.4

/** A box trees keep off: centre and half sizes. */
interface Keep {
  readonly x: number
  readonly y: number
  readonly rx: number
  readonly ry: number
}

/** The west park with its pond and tai chi plaza, and the east one with its outdoor gym. */
export function paintSideParks(scene: CityScene): void {
  paintSidePark(scene, { side: -1, park: PARKS[1] })
  paintSidePark(scene, { side: 1, park: PARKS[2] })
}

function paintSidePark(scene: CityScene, at: { readonly side: Side; readonly park: Park }): void {
  const { side, park } = at
  const x = (u: number): number => parkX(side, u)
  const { pond, sideBed } = PARK_FEATURES
  const isWest = side < 0

  if (isWest) {
    paintPlaza(scene, side)
  } else {
    paintGymPad(scene, side)
  }

  paintPaths(scene, park)

  if (isWest) {
    paintPond(scene, { x: x(pond.u), y: pond.y, rx: pond.rx, ry: pond.ry })
  } else {
    paintBed(scene, { x: x(sideBed.u), y: sideBed.y, rx: sideBed.rx, ry: sideBed.ry })
    paintGym(scene, side)
  }

  for (const bench of park.benches) {
    paintBench(scene, bench)
  }

  for (const y of SIDE_LAMPS.ys) {
    paintLamp(scene, { x: x(SIDE_LAMPS.u), y }, side < 0 ? 1 : -1)
  }

  paintScatter(scene, sideScatterOf(side))
  paintHedgeRail(scene, {
    line: x(HEDGE_IN),
    from: SIDE_PARK.top,
    to: STREET_BOTTOM,
    isAlongX: false,
    gaps: park.gates.map((gate) => park.nodes[gate]?.y ?? 0),
  })
}

function paintPlaza(scene: CityScene, side: Side): void {
  const { g } = scene
  const { plaza } = PARK_FEATURES
  const x = parkX(side, plaza.u)

  g.fillStyle = shadeOf(scene, PLAZA.stone)
  g.beginPath()
  g.ellipse(x, plaza.y, plaza.r, plaza.r * PLAZA.squash, 0, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = shadeOf(scene, PLAZA.inner)
  g.beginPath()
  g.ellipse(
    x,
    plaza.y,
    plaza.r - PLAZA.inset,
    (plaza.r - PLAZA.inset) * PLAZA.squash,
    0,
    0,
    Math.PI * 2
  )
  g.fill()
}

function paintGymPad(scene: CityScene, side: Side): void {
  const { g } = scene
  const { u0, u1, y0, y1 } = PARK_FEATURES.gymPad
  const x0 = Math.min(parkX(side, u0), parkX(side, u1))
  const w = Math.abs(parkX(side, u1) - parkX(side, u0))

  g.fillStyle = shadeOf(scene, PAD.floor)
  g.fillRect(x0, y0, w, y1 - y0)
  g.strokeStyle = shadeOf(scene, PAD.edge)
  g.lineWidth = PAD.edgeW
  g.strokeRect(x0, y0, w, y1 - y0)
}

// The eight machines down the pad and the gym's sign at its north end.
function paintGym(scene: CityScene, side: Side): void {
  const { gymSign } = PARK_FEATURES

  for (const [index, kind] of GYM_MACHINES.kinds.entries()) {
    paintGymMachine(scene, {
      x: parkX(side, GYM_MACHINES.u),
      y: GYM_MACHINES.y0 + index * GYM_MACHINES.step,
      kind,
    })
  }

  paintSign(scene, {
    at: { x: parkX(side, gymSign.u), y: gymSign.y },
    text: tr('ui.office.street.gym'),
    isPlate: false,
  })
}

/** The promenade, the roundabout garden, benches, lamps, trees and the hedge along the plaza. */
export function paintSouthPark(scene: CityScene): void {
  const park = PARKS[3]
  const { southBed } = PARK_FEATURES
  const { top, promenade } = SOUTH_PARK
  const { south } = SCATTER

  paintPaths(scene, park)
  paintBed(scene, { x: southBed.x, y: promenade, rx: southBed.rx, ry: southBed.ry })

  for (const bench of park.benches) {
    paintBench(scene, bench)
  }

  for (const x of SOUTH_LAMPS.xs) {
    paintLamp(scene, { x, y: promenade + SOUTH_LAMPS.dy }, 1)
  }

  paintScatter(scene, {
    seed: park.id,
    count: south.count,
    x0: south.inset,
    x1: WORLD.w - south.inset,
    y0: promenade + south.below,
    y1: STREET_BOTTOM - south.above,
    keep: [],
  })
  paintHedgeRail(scene, {
    line: top + HEDGE_IN,
    from: 1,
    to: WORLD.w,
    isAlongX: true,
    gaps: park.gates.map((gate) => park.nodes[gate]?.x ?? 0),
  })
}

// An oval flower bed with a small tree in it.
function paintBed(
  scene: CityScene,
  bed: { readonly x: number; readonly y: number; readonly rx: number; readonly ry: number }
): void {
  const { g } = scene

  g.fillStyle = shadeOf(scene, BED.soil)
  g.beginPath()
  g.ellipse(bed.x, bed.y, bed.rx + 1.2, bed.ry + 1, 0, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = shadeOf(scene, BED.green)
  g.beginPath()
  g.ellipse(bed.x, bed.y, bed.rx, bed.ry, 0, 0, Math.PI * 2)
  g.fill()

  for (let index = 0; index < BED.count; index++) {
    const angle = index * BED.turn
    const reach = 0.35 + (index % 5) * 0.13

    g.fillStyle = shadeOf(scene, BED.flowers[index % BED.flowers.length] ?? BED.green)
    g.beginPath()
    g.arc(
      bed.x + Math.cos(angle) * bed.rx * reach,
      bed.y + Math.sin(angle) * bed.ry * reach,
      0.75,
      0,
      Math.PI * 2
    )
    g.fill()
  }

  paintTree(scene, { x: bed.x, y: bed.y + bed.ry * 0.4 }, 1)
}

// A side park's far half, clear of the ring round its bed and (west) its pond.
function sideScatterOf(side: Side): Scatter {
  const { pond, sideBed } = PARK_FEATURES
  const { side: area } = SCATTER
  const a = parkX(side, area.u0)
  const b = parkX(side, SIDE_PARK.depth - area.inset)
  const keep: Keep[] = [{ x: parkX(side, sideBed.u), y: sideBed.y, ...SIDE_RINGS.bed }]

  if (side < 0) {
    keep.push({ x: parkX(side, pond.u), y: pond.y, ...SIDE_RINGS.pond })
  }

  return {
    seed: side < 0 ? 'west' : 'east',
    count: area.count,
    x0: Math.min(a, b),
    x1: Math.max(a, b),
    y0: SIDE_PARK.top + area.top,
    y1: STREET_BOTTOM,
    keep,
  }
}

/** Where a park's trees may stand. */
interface Scatter {
  readonly seed: string
  readonly count: number
  readonly x0: number
  readonly x1: number
  readonly y0: number
  readonly y1: number
  readonly keep: readonly Keep[]
}

// Seeded places, each clear of the kept boxes and of the trees already placed; north to south.
function paintScatter(scene: CityScene, area: Scatter): void {
  const rng = createRng(seedOf('park-trees', area.seed))
  const trees: { readonly x: number; readonly y: number; readonly kind: number }[] = []

  for (let tries = 0; tries < SCATTER.tries && trees.length < area.count; tries++) {
    const x = area.x0 + rng.next() * (area.x1 - area.x0)
    const y = area.y0 + rng.next() * (area.y1 - area.y0)
    const kind = rng.int(0, SCATTER.kinds - 1)
    const isKept = area.keep.some(
      (box) =>
        Math.abs(x - box.x) < box.rx + SCATTER.ringPad &&
        Math.abs(y - box.y) < box.ry + SCATTER.ringPad
    )
    const isCrowded = trees.some((tree) => Math.hypot(tree.x - x, tree.y - y) < SCATTER.apart)

    if (!(isKept || isCrowded)) {
      trees.push({ x, y, kind })
    }
  }

  for (const tree of trees.sort((a, b) => a.y - b.y)) {
    paintTree(scene, tree, tree.kind)
  }
}
