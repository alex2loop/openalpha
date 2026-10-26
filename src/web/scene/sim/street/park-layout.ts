import type { Heading } from '@/web/scene/street-types'
import { type Point, WORLD } from '@/web/scene/types'
import { NORTH, sideX } from '@/web/scene/world/street-layout'

type Side = -1 | 1
type NodeSpec = readonly [string, number, number]
type BenchSpec = readonly [number, number, Side, string]
type SpotSpec = readonly [number, number, string, Heading, boolean]

/** The four parks: behind the far pavement west of the shop row, beside each side street, and
 *  south of the building's plaza. */
const PARK_IDS = ['north', 'west', 'east', 'south'] as const
type ParkId = (typeof PARK_IDS)[number]

/** The north park's lawn, its fountain and the playground's rubber floor, in world px. */
export const NORTH_PARK = Object.freeze({
  x0: -96,
  x1: 146,
  y0: -88,
  y1: NORTH.farTop - 2,
  fountain: { x: -8, y: -60, ring: 14 },
  rubber: { x0: 88, y0: -78, x1: 134, y1: -63 },
})
/** The low wall at the north park's east corner the stray cat keeps to: its middle, half length and
 *  top. */
export const CAT_WALL = Object.freeze({ x: 128, half: 16, top: -33.1 })
/** A side park, as distances out from the building's side wall: the street edge where its gates
 *  are, its depth, and where it starts and ends north to south. */
export const SIDE_PARK = Object.freeze({ inner: 82, depth: 110, top: 34, bottom: 624 })
/** The south park under the plaza: its top edge (the gates) and its promenade's line. */
export const SOUTH_PARK = Object.freeze({ top: WORLD.h + 98, promenade: WORLD.h + 126 })
/** The west park's pond and tai chi plaza, the east park's gym pad and sign, and the flower beds,
 *  as distances out from the wall (`u`) and world y. */
export const PARK_FEATURES = Object.freeze({
  pond: { u: 76, y: 300, rx: 25, ry: 16 },
  plaza: { u: 14, y: 420, r: 13 },
  gymPad: { u0: 3, u1: 21, y0: 355, y1: 461 },
  gymSign: { u: 8, y: 351 },
  sideBed: { u: 76, y: 420, rx: 15, ry: 12 },
  southBed: { x: WORLD.w / 2, rx: 17, ry: 8 },
})
/** The east park's eight machines, north to south, `u` out from the wall from `y0`, `step` apart. */
export const GYM_MACHINES = Object.freeze({
  kinds: ['air', 'press', 'bike', 'pull', 'twist', 'bars', 'air', 'press'] as const,
  u: 9,
  y0: 362,
  step: 12.5,
})
export type GymMachine = (typeof GYM_MACHINES.kinds)[number]
/** The north park's playground pieces. */
export const PLAY_PIECES = Object.freeze([
  { kind: 'slide', x: 100, y: -71 },
  { kind: 'swing', x: 118, y: -72 },
  { kind: 'seesaw', x: 128, y: -67 },
] as const)
/** Where the playground's children play. */
export const PLAY_SPOTS: readonly [Point, ...Point[]] = Object.freeze([
  { x: 100, y: -67 },
  { x: 116, y: -68 },
  { x: 126, y: -65 },
  { x: 108, y: -74 },
  { x: 124, y: -75 },
])
const RING_NODES = 12
const NORTH_LOOP = ['f1', 'f2', 'f3', 'f4', 'm4', 'b2', 'b1', 'b0', 'm0', 'f0'] as const
const NORTH_SPEC = Object.freeze({
  id: 'north',
  side: 0,
  nodes: [
    ['g1', -56, NORTH.farTop - 1.4],
    ['g2', 40, NORTH.farTop - 1.4],
    ['f0', -88, -38],
    ['f1', -56, -38],
    ['f2', -8, -38],
    ['f3', 40, -38],
    ['f4', 138, -38],
    ['m0', -88, -60],
    ['mw', -38, -60],
    ['me', 22, -60],
    ['mc', 62, -60],
    ['ma', 82, -60],
    ['m3', 112, -60],
    ['m4', 138, -60],
    ['b0', -88, -80],
    ['b1', -8, -80],
    ['b2', 138, -80],
    ['pg', 112, -70],
  ],
  rings: [
    {
      prefix: 'r',
      x: NORTH_PARK.fountain.x,
      y: NORTH_PARK.fountain.y,
      rx: NORTH_PARK.fountain.ring,
      ry: NORTH_PARK.fountain.ring,
    },
  ],
  edges:
    'g1-f1 g2-f3 f0-f1 f1-f2 f2-f3 f3-f4 f0-m0 m0-b0 f4-m4 m4-b2 m0-mw mw-r0 r6-me me-mc mc-ma ' +
    'ma-m3 m3-m4 b0-b1 b1-b2 f2-r9 r3-b1 m3-pg',
  gates: ['g1', 'g2'],
  benches: [
    [-38, -65, 1, 'mw'],
    [-38, -55, 1, 'mw'],
    [22, -65, -1, 'me'],
    [22, -55, -1, 'me'],
    [82, -67, 1, 'ma'],
    [62, -51, -1, 'mc'],
  ],
  spots: [],
  loop: [...NORTH_LOOP, ...NORTH_LOOP, 'f1'],
  strolls: ['f4', 'b2', 'm0', 'mw', 'me', 'm3', 'b0', 'pg', 'f0', 'b1', 'm4', 'mc', 'r3', 'f2'],
  play: 'pg',
} satisfies ParkSpec)
// A side park's spine, `u` out, down its length; its gates (by the spine node each joins), the
// bench rows either side of the spine, the ring path round the flower bed (the west one's pond too).
const SPINE_U = 28
const SPINE_Y = [56, 130, 170, 215, 243, 300, 345, 420, 470, 520, 580, 624] as const
const SIDE_GATES = [1, 5, 9] as const
const SIDE_GATE_U = 2
const SIDE_BENCHES = [2, 4, 6, 8, 10] as const
const SIDE_BENCH_U = [19, 37] as const
/** The ring paths' half sizes round a side park's flower bed and pond; trees keep off them. */
export const SIDE_RINGS = Object.freeze({ bed: { rx: 24, ry: 20 }, pond: { rx: 32, ry: 23 } })
const SIDE_STROLLS = ['s0', 's2', 's3', 's4', 's6', 's7', 's8', 's11', 's2', 's4', 's6', 's8', 'b3']
// The tai chi group's places round the plaza, and the gym's places beside each machine.
const TAI_CHI = [
  [-9, -2],
  [3, -6],
  [10, 3],
] as const
const GYM_SPOT = Object.freeze({ u: 17, dy: 1.5, node: 's7' })
// The south promenade's nodes either side of the garden, its gates from the plaza (by x and the
// node each joins), and its benches.
const SOUTH_WEST_X = [10, 60, 130, 190, 215] as const
const SOUTH_EAST_X = [425, 450, 510, 580, 630] as const
const SOUTH_GATES = [
  [130, 'p2'],
  [WORLD.w / 2, 'r2'],
  [510, 'q2'],
] as const
const SOUTH_BENCHES = [
  [60, 1, 'p1'],
  [190, -1, 'p3'],
  [450, 1, 'q1'],
  [580, -1, 'q3'],
] as const
const SOUTH_BENCH_DY = 7
const SOUTH_RING = Object.freeze({ rx: 24, ry: 14 })

/** A park bench: where it stands, which way its sitter faces, and the path node beside it. */
interface Bench {
  readonly at: Point
  readonly facing: Side
  readonly node: number
}

/** A place someone trains on, reached from `node`: a gym machine, or a place in the tai chi group
 *  (`isStill`). */
export interface TrainSpot {
  readonly at: Point
  readonly node: number
  readonly facing: Heading
  readonly isStill: boolean
}

/** One park: its path graph (`hops[a * nodes.length + b]` is the next node from `a` toward `b`),
 *  gates, benches, training spots, the jog route's turning points, where strollers go, and the
 *  playground's node. */
export interface Park {
  readonly id: ParkId
  readonly side: Side | 0
  readonly nodes: readonly Point[]
  readonly edges: readonly (readonly [number, number])[]
  readonly hops: Int16Array
  readonly gates: readonly number[]
  readonly benches: readonly Bench[]
  readonly spots: readonly TrainSpot[]
  readonly loop: readonly number[]
  readonly strolls: readonly number[]
  readonly play: number | undefined
}

/** Twelve nodes `prefix0` to `prefix11` round an ellipse, joined in a ring. */
interface RingSpec {
  readonly prefix: string
  readonly x: number
  readonly y: number
  readonly rx: number
  readonly ry: number
}

/** What a park is built from, by node name. */
interface ParkSpec {
  readonly id: ParkId
  readonly side: Side | 0
  readonly nodes: readonly NodeSpec[]
  readonly rings: readonly RingSpec[]
  readonly edges: string
  readonly gates: readonly string[]
  readonly benches: readonly BenchSpec[]
  readonly spots: readonly SpotSpec[]
  readonly loop: readonly string[]
  readonly strolls: readonly string[]
  readonly play?: string
}

/** The four parks, in `PARK_IDS` order. */
export const PARKS: readonly [Park, Park, Park, Park] = Object.freeze([
  buildPark(NORTH_SPEC),
  buildPark(sideSpec(-1)),
  buildPark(sideSpec(1)),
  buildPark(southSpec()),
])

/** The world x `u` out from a side park's street edge, on `side`. */
export function parkX(side: Side, u: number): number {
  return sideX(side, SIDE_PARK.inner + u)
}

// A spine with three gates to the street, benches either side, a ring path off it round the
// flower bed; the west park's second ring round its pond, its tai chi plaza, the east one's gym.
function sideSpec(side: Side): ParkSpec {
  const x = (u: number): number => parkX(side, u)
  const { pond, sideBed } = PARK_FEATURES
  const isWest = side < 0
  // The ring node nearest the spine.
  const link = isWest ? 6 : 0
  const spine = SPINE_Y.map((y, index): NodeSpec => [`s${index}`, x(SPINE_U), y])
  const gates = SIDE_GATES.map((at, index): NodeSpec => [`g${index}`, x(SIDE_GATE_U), SPINE_Y[at]])
  const bed: RingSpec = { prefix: 'b', x: x(sideBed.u), y: sideBed.y, ...SIDE_RINGS.bed }
  const pondRing: RingSpec = { prefix: 'a', x: x(pond.u), y: pond.y, ...SIDE_RINGS.pond }

  return {
    id: isWest ? 'west' : 'east',
    side,
    nodes: [...spine, ...gates],
    rings: isWest ? [bed, pondRing] : [bed],
    edges: [
      ...spine.slice(1).map((node, index) => `s${index}-${node[0]}`),
      ...SIDE_GATES.map((at, index) => `g${index}-s${at}`),
      `s7-b${link}`,
      ...(isWest ? [`s5-a${link}`] : []),
    ].join(' '),
    gates: gates.map((gate) => gate[0]),
    benches: sideBenches(side),
    spots: isWest ? taiChiSpots(side) : gymSpots(side),
    loop: ['s0', 's11'],
    strolls: SIDE_STROLLS,
  }
}

// Two benches at each bench row, facing the spine, the outer one left out where the path bends.
function sideBenches(side: Side): BenchSpec[] {
  const benches: BenchSpec[] = []

  for (const at of SIDE_BENCHES) {
    for (const u of SIDE_BENCH_U) {
      const x = parkX(side, u)

      if (!(at === 4 && u === SIDE_BENCH_U[1])) {
        benches.push([x, SPINE_Y[at], parkX(side, SPINE_U) > x ? 1 : -1, `s${at}`])
      }
    }
  }

  return benches
}

function taiChiSpots(side: Side): SpotSpec[] {
  const { plaza } = PARK_FEATURES

  return TAI_CHI.map(([dx, dy]) => [parkX(side, plaza.u) + dx, plaza.y + dy, 's7', 'south', true])
}

// Beside each machine, facing it.
function gymSpots(side: Side): SpotSpec[] {
  const facing: Heading = side < 0 ? 'east' : 'west'

  return GYM_MACHINES.kinds.map((_, index) => [
    parkX(side, GYM_SPOT.u),
    GYM_MACHINES.y0 + index * GYM_MACHINES.step + GYM_SPOT.dy,
    GYM_SPOT.node,
    facing,
    false,
  ])
}

// The promenade either side of the roundabout garden, three gates from the plaza, four benches.
function southSpec(): ParkSpec {
  const y = SOUTH_PARK.promenade
  const west = SOUTH_WEST_X.map((x, index): NodeSpec => [`p${index}`, x, y])
  const east = SOUTH_EAST_X.map((x, index): NodeSpec => [`q${index}`, x, y])
  const gates = SOUTH_GATES.map(([x], index): NodeSpec => [`g${index}`, x, SOUTH_PARK.top + 2])

  return {
    id: 'south',
    side: 0,
    nodes: [...west, ...east, ...gates],
    rings: [{ prefix: 'r', x: PARK_FEATURES.southBed.x, y, ...SOUTH_RING }],
    edges: [
      ...west.slice(1).map((node, index) => `p${index}-${node[0]}`),
      ...east.slice(1).map((node, index) => `q${index}-${node[0]}`),
      ...SOUTH_GATES.map(([, node], index) => `g${index}-${node}`),
      'p4-r0 r6-q0',
    ].join(' '),
    gates: gates.map((gate) => gate[0]),
    benches: SOUTH_BENCHES.map(([x, facing, node]) => [x, y + SOUTH_BENCH_DY, facing, node]),
    spots: [],
    loop: ['p0', 'q4'],
    strolls: ['p0', 'p3', 'q1', 'q4', 'r9'],
  }
}

function buildPark(spec: ParkSpec): Park {
  const nodes = [...spec.nodes, ...spec.rings.flatMap(ringNodesOf)]
  const names = new Map(nodes.map(([name], index) => [name, index]))
  const at = (name: string): number => names.get(name) ?? 0
  const edges = [...spec.edges.split(' '), ...spec.rings.flatMap(ringEdgesOf)].map((edge) => {
    const [a = '', b = ''] = edge.split('-')

    return [at(a), at(b)] as const
  })

  return {
    id: spec.id,
    side: spec.side,
    nodes: nodes.map(([, x, y]) => Object.freeze({ x, y })),
    edges,
    hops: hopsOf(nodes.length, edges),
    gates: spec.gates.map(at),
    benches: spec.benches.map(([x, y, facing, node]) => ({ at: { x, y }, facing, node: at(node) })),
    spots: spec.spots.map(([x, y, node, facing, isStill]) => ({
      at: { x, y },
      node: at(node),
      facing,
      isStill,
    })),
    loop: spec.loop.map(at),
    strolls: spec.strolls.map(at),
    play: spec.play === undefined ? undefined : at(spec.play),
  }
}

// From the ellipse's west end, clockwise on screen: the north end is node 3, the south end 9.
function ringNodesOf(ring: RingSpec): NodeSpec[] {
  return Array.from({ length: RING_NODES }, (_, k): NodeSpec => {
    const angle = Math.PI + (k * 2 * Math.PI) / RING_NODES

    return [
      `${ring.prefix}${k}`,
      ring.x + Math.cos(angle) * ring.rx,
      ring.y + Math.sin(angle) * ring.ry,
    ]
  })
}

function ringEdgesOf(ring: RingSpec): string[] {
  return Array.from(
    { length: RING_NODES },
    (_, k) => `${ring.prefix}${k}-${ring.prefix}${(k + 1) % RING_NODES}`
  )
}

// The next node on a shortest path between every pair, by a breadth-first search from each target.
function hopsOf(count: number, edges: readonly (readonly [number, number])[]): Int16Array {
  const hops = new Int16Array(count * count).fill(-1)
  const near: number[][] = Array.from({ length: count }, () => [])

  for (const [a, b] of edges) {
    near[a]?.push(b)
    near[b]?.push(a)
  }

  for (let target = 0; target < count; target++) {
    const queue = [target]

    hops[target * count + target] = target

    for (let head = 0; head < queue.length; head++) {
      const node = queue[head] ?? target

      for (const next of near[node] ?? []) {
        if (hops[next * count + target] === -1) {
          hops[next * count + target] = node
          queue.push(next)
        }
      }
    }
  }

  return hops
}
