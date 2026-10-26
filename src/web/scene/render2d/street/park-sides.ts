import type { CityScene } from '@/web/scene/render2d/street/city-blocks'
import type { Park } from '@/web/scene/sim/street/park-layout'
import { paintTree } from '@/web/scene/render2d/street/city-blocks'
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
  paintBigTree,
  paintLawnTexture,
  paintParkLamp,
  scatterBigTrees,
  type TreeArea,
} from '@/web/scene/render2d/street/park-trees'
import { mixTone } from '@/web/scene/render2d/street/tone'
import {
  GYM_MACHINES,
  PARK_FEATURES,
  PARKS,
  parkX,
  SIDE_PARK,
  SIDE_RINGS,
  SOUTH_PARK,
  SOUTH_RING,
} from '@/web/scene/sim/street/park-layout'
import { WORLD } from '@/web/scene/types'
import { STREET_BOTTOM } from '@/web/scene/view'
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
// Big trees over each park, their crowns clear of the spine, the gates, the rings and the gym.
const TREES = Object.freeze({
  side: {
    count: 30,
    inset: 8,
    top: 36,
    bottom: 8,
    spine: { u0: 12, u1: 44 },
    gateU: 14,
    gateHalf: 9,
  },
  south: {
    count: 16,
    inset: 14,
    below: 28,
    end: 60,
    endPad: 8,
    band: { above: 12, below: 16 },
    stemHalf: 9,
  },
  ringPad: { x: 8, top: 10, bottom: 4 },
})
const INNER_HEDGE = Object.freeze({ tone: '#4E9568', night: '#1A3226', share: 0.8, in: 1.6 })
const INNER_HEDGE_STEP = 4.6
const INNER_HEDGE_R = 2.7
const HEDGE_IN = 1.4

type KeepBox = readonly [number, number, number, number]

/** The west park with its pond and tai chi plaza, and the east one with its outdoor gym. */
export function paintSideParks(scene: CityScene): void {
  paintSidePark(scene, { side: -1, park: PARKS[1] })
  paintSidePark(scene, { side: 1, park: PARKS[2] })
}

function paintSidePark(scene: CityScene, at: { readonly side: Side; readonly park: Park }): void {
  const { side, park } = at
  const x = (u: number): number => parkX(side, u)
  const a = x(0)
  const b = x(SIDE_PARK.depth)

  paintLawnTexture(
    scene,
    { x0: Math.min(a, b), x1: Math.max(a, b), y0: SIDE_PARK.top, y1: STREET_BOTTOM },
    side < 0 ? 'west' : 'east'
  )
  paintFeatures(scene, at)

  for (const bench of park.benches) {
    paintBench(scene, bench)
  }

  paintHedgeRow(scene, {
    from: SIDE_PARK.top,
    to: STREET_BOTTOM,
    line: x(SIDE_PARK.depth - INNER_HEDGE.in),
    isAlongX: false,
  })

  for (const y of SIDE_LAMPS.ys) {
    paintParkLamp(scene, { x: x(SIDE_LAMPS.u), y })
  }

  paintBigTrees(scene, sideTreesOf(side, park))
  paintHedgeRail(scene, {
    line: x(HEDGE_IN),
    from: SIDE_PARK.top,
    to: STREET_BOTTOM,
    isAlongX: false,
    gaps: park.gates.map((gate) => park.nodes[gate]?.y ?? 0),
  })
}

// The west park's plaza and pond, or the east park's gym pad, flower bed and machines, round the
// paths.
function paintFeatures(scene: CityScene, at: { readonly side: Side; readonly park: Park }): void {
  const { side } = at
  const x = (u: number): number => parkX(side, u)
  const { pond, sideBed } = PARK_FEATURES

  if (side < 0) {
    paintPlaza(scene, side)
    paintPaths(scene, at.park)
    paintPond(scene, { x: x(pond.u), y: pond.y, rx: pond.rx, ry: pond.ry })
    return
  }

  paintGymPad(scene, side)
  paintPaths(scene, at.park)
  paintBed(scene, { x: x(sideBed.u), y: sideBed.y, rx: sideBed.rx, ry: sideBed.ry, tree: 1 })
  paintGym(scene, side)
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

  const end = STREET_BOTTOM - TREES.south.end

  paintLawnTexture(scene, { x0: 0, x1: WORLD.w, y0: top, y1: end }, 'south')
  paintPaths(scene, park)
  paintBed(scene, { x: southBed.x, y: promenade, rx: southBed.rx, ry: southBed.ry, tree: 2 })

  for (const bench of park.benches) {
    paintBench(scene, bench)
  }

  paintHedgeRow(scene, { from: 1, to: WORLD.w, line: end - INNER_HEDGE.in, isAlongX: true })

  for (const x of SOUTH_LAMPS.xs) {
    paintParkLamp(scene, { x, y: promenade + SOUTH_LAMPS.dy })
  }

  paintBigTrees(scene, southTreesOf(park))
  paintHedgeRail(scene, {
    line: top + HEDGE_IN,
    from: 1,
    to: WORLD.w,
    isAlongX: true,
    gaps: park.gates.map((gate) => park.nodes[gate]?.x ?? 0),
  })
}

// An oval flower bed with a small tree of look `tree` in it.
function paintBed(
  scene: CityScene,
  bed: {
    readonly x: number
    readonly y: number
    readonly rx: number
    readonly ry: number
    readonly tree: number
  }
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

  paintTree(scene, { x: bed.x, y: bed.y + bed.ry * 0.4 }, bed.tree)
}

// A row of hedge along a park's inner edge.
function paintHedgeRow(
  scene: CityScene,
  row: {
    readonly from: number
    readonly to: number
    readonly line: number
    readonly isAlongX: boolean
  }
): void {
  const { g } = scene

  g.fillStyle = mixTone(INNER_HEDGE.tone, INNER_HEDGE.night, scene.dark * INNER_HEDGE.share)

  for (let along = row.from; along < row.to; along += INNER_HEDGE_STEP) {
    g.beginPath()
    g.arc(
      row.isAlongX ? along : row.line,
      row.isAlongX ? row.line : along,
      INNER_HEDGE_R,
      0,
      Math.PI * 2
    )
    g.fill()
  }
}

function paintBigTrees(scene: CityScene, area: TreeArea): void {
  for (const tree of scatterBigTrees(area)) {
    paintBigTree(scene, tree)
  }
}

// A side park's trees keep off its spine path and benches, its gates, the rings round its bed and
// (west) its pond, and (east) the gym pad.
function sideTreesOf(side: Side, park: Park): TreeArea {
  const { pond, sideBed, gymPad } = PARK_FEATURES
  const { side: area } = TREES
  const band = (u: readonly [number, number], y: readonly [number, number]): KeepBox => {
    const a = parkX(side, u[0])
    const b = parkX(side, u[1])

    return [Math.min(a, b), Math.max(a, b), y[0], y[1]]
  }
  const keep: KeepBox[] = [
    band([area.spine.u0, area.spine.u1], [SIDE_PARK.top, STREET_BOTTOM]),
    ringBox(parkX(side, sideBed.u), sideBed.y, SIDE_RINGS.bed),
    ...park.gates.map((gate) => {
      const y = park.nodes[gate]?.y ?? 0

      return band([0, area.gateU], [y - area.gateHalf, y + area.gateHalf])
    }),
  ]

  if (side < 0) {
    keep.push(ringBox(parkX(side, pond.u), pond.y, SIDE_RINGS.pond))
  } else {
    keep.push(band([gymPad.u0 - 1, gymPad.u1], [gymPad.y0 - 3, gymPad.y1 + 1]))
  }

  const a = parkX(side, area.inset)
  const b = parkX(side, SIDE_PARK.depth - area.inset)

  return {
    seed: side < 0 ? 'west' : 'east',
    count: area.count,
    x0: Math.min(a, b),
    x1: Math.max(a, b),
    y0: SIDE_PARK.top + area.top,
    y1: STREET_BOTTOM - area.bottom,
    keep,
  }
}

// The south park's trees keep off the promenade, the gates' stems and the garden's ring.
function southTreesOf(park: Park): TreeArea {
  const { top, promenade } = SOUTH_PARK
  const { south } = TREES
  const keep: KeepBox[] = [
    [0, WORLD.w, promenade - south.band.above, promenade + south.band.below],
    ringBox(PARK_FEATURES.southBed.x, promenade, SOUTH_RING),
    ...park.gates.map((gate): KeepBox => {
      const x = park.nodes[gate]?.x ?? 0

      return [x - south.stemHalf, x + south.stemHalf, top, promenade]
    }),
  ]

  return {
    seed: 'south',
    count: south.count,
    x0: south.inset,
    x1: WORLD.w - south.inset,
    y0: promenade + south.below,
    y1: STREET_BOTTOM - south.end - south.endPad,
    keep,
  }
}

function ringBox(
  x: number,
  y: number,
  ring: { readonly rx: number; readonly ry: number }
): KeepBox {
  const pad = TREES.ringPad

  return [x - ring.rx - pad.x, x + ring.rx + pad.x, y - ring.ry - pad.top, y + ring.ry + pad.bottom]
}
