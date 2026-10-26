import type {
  BikeShape,
  CarSize,
  Heading,
  RiderGear,
  VehicleKind,
  VehicleView,
} from '@/web/scene/types'
import type { BusStop, RegionPack, SideStreet } from '@/web/scene/world/regions'
import { WORLD } from '@/web/scene/types'
import { STREET_RECT } from '@/web/scene/view'
import { METRES_PER_PX, NORTH, SHELTER_X, SIDE_ROAD, sideX } from '@/web/scene/world/street-layout'
import { MINUTES_PER_HOUR, SECONDS_PER_MINUTE } from '@/web/text/time-units'

// The north street runs this far past each side wall; a vehicle enters and leaves there.
const NORTH_REACH_PX = 314
// Traffic cruises at this share of the posted limit.
const CRUISE_SHARE = 0.85
const METRES_PER_KM = 1_000
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR
// A motorbike's columns across its carriageway, as shares of the half width: the kerb slot it
// slips along, the middle and the inner one it bunches into.
const KERB_SHARE = 0.92
const INNER_SHARE = -0.65
// Each way of a two-way side street keeps to this share of the road's width from the middle.
const SIDE_WAY_SHARE = 0.25

export type StreetId = 'north' | 'west' | 'east'

/** One way of one street: its axis and direction, the line it keeps across the axis and half its
 *  width, where it runs from and to, its cruising px a second, the motorbike columns, the bus
 *  stops along it in travel order and the routes they show, and its queue this step, front
 *  first. */
export interface Flow {
  readonly street: StreetId
  readonly axis: 'x' | 'y'
  readonly dir: 1 | -1
  readonly heading: Heading
  readonly line: number
  readonly halfWidth: number
  readonly from: number
  readonly to: number
  readonly cruise: number
  readonly columns: readonly [kerb: number, middle: number, inner: number]
  readonly stops: readonly number[]
  readonly routes: readonly string[]
  readonly queue: Vehicle[]
}

interface MutablePoint {
  x: number
  y: number
}

/** A vehicle of the pool, written only by the street sim; the painter reads it as a view. */
export interface Vehicle extends VehicleView {
  on: boolean
  flow: Flow
  pos: number
  len: number
  width: number
  pace: number
  speed: number
  lateral: number
  column: 0 | 1 | 2
  squeezes: boolean
  stops: readonly number[]
  stopIndex: number
  dwellUntil: number
  turnTo: Flow | undefined
  waitMs: number
  prev: MutablePoint
  at: MutablePoint
  kind: VehicleKind
  heading: Heading
  car: CarSize
  bike: BikeShape
  gear: RiderGear
  passenger: boolean
  look: number
  route: string
  footDown: boolean
}

/** A shelter on the north street: its stop and where it stands. */
export interface Shelter {
  readonly stop: BusStop
  readonly x: number
}

/** The street's ways: every flow, the north ones, and the one a side street's traffic turns
 *  right onto. */
export interface Flows {
  readonly all: readonly [Flow, ...Flow[]]
  readonly north: readonly [Flow, ...Flow[]]
  readonly turnOnto: Flow | undefined
}

/** The pack's shelters on each side, matched in order to their spots along the north street. */
export function sheltersOf(pack: RegionPack): readonly Shelter[] {
  const far = pack.stops.filter((stop) => stop.side === 'far')
  const near = pack.stops.filter((stop) => stop.side === 'near')
  const placed = (stops: readonly BusStop[], spots: readonly number[]): Shelter[] =>
    stops.slice(0, spots.length).map((stop, index) => ({ stop, x: spots[index] ?? 0 }))

  return [...placed(far, SHELTER_X.far), ...placed(near, SHELTER_X.near)]
}

/** The ways of the pack's road. The north street's far way runs west when it carries both ways
 *  (right-hand traffic); each side street runs from the north street's near kerb to the edge. */
export function flowsOf(pack: RegionPack): Flows {
  const north = northFlowsOf(pack)
  const all: readonly [Flow, ...Flow[]] = [
    ...north,
    ...sideFlowsOf(pack, { side: -1, street: pack.road.west }),
    ...sideFlowsOf(pack, { side: 1, street: pack.road.east }),
  ]

  return { all, north, turnOnto: north.findLast((flow) => flow.dir > 0) }
}

// One way when the road runs one way on one carriageway, else two bands across it.
function northFlowsOf(pack: RegionPack): readonly [Flow, ...Flow[]] {
  const { north } = pack.road
  const count = north.carriageways === 2 || !north.oneWay ? 2 : 1
  const first = northFlowOf(pack, { index: 0, count })

  return count > 1 ? [first, northFlowOf(pack, { index: 1, count })] : [first]
}

function northFlowOf(
  pack: RegionPack,
  at: { readonly index: number; readonly count: number }
): Flow {
  const band = (NORTH.roadBottom - NORTH.roadTop) / at.count
  const dir = pack.road.north.oneWay || at.index > 0 ? 1 : -1
  const half = (band / 2) * dir
  const side = dir < 0 ? 'far' : 'near'
  const mine = sheltersOf(pack).filter((shelter) => shelter.stop.side === side)

  return {
    street: 'north',
    axis: 'x',
    dir,
    heading: dir > 0 ? 'east' : 'west',
    line: NORTH.roadTop + band * (at.index + 0.5),
    halfWidth: band / 2,
    from: -NORTH_REACH_PX,
    to: WORLD.w + NORTH_REACH_PX,
    cruise: cruiseOf(pack.speed.north),
    columns: [half * KERB_SHARE, 0, half * INNER_SHARE],
    stops: mine.map((shelter) => shelter.x).sort((a, b) => (a - b) * dir),
    routes: mine.flatMap((shelter) => shelter.stop.routes),
    queue: [],
  }
}

function sideFlowsOf(
  pack: RegionPack,
  at: { readonly side: -1 | 1; readonly street: SideStreet }
): Flow[] {
  const centre = sideX(at.side, (SIDE_ROAD.from + SIDE_ROAD.to) / 2)
  const offset = (SIDE_ROAD.to - SIDE_ROAD.from) * SIDE_WAY_SHARE
  const isTwoWay = at.street.lanes > 1 && !at.street.oneWay
  const ways: readonly (1 | -1)[] = isTwoWay ? [1, -1] : [1]

  return ways.map(
    (dir): Flow => ({
      street: at.side < 0 ? 'west' : 'east',
      axis: 'y',
      dir,
      heading: dir > 0 ? 'south' : 'north',
      line: isTwoWay ? centre - offset * dir : centre,
      halfWidth: isTwoWay ? offset : offset * 2,
      from: NORTH.roadBottom,
      to: STREET_RECT.y + STREET_RECT.h,
      cruise: cruiseOf(pack.speed.side),
      columns: [0, 0, 0],
      stops: [],
      routes: [],
      queue: [],
    })
  )
}

function cruiseOf(limitKmh: number): number {
  return ((limitKmh * METRES_PER_KM) / SECONDS_PER_HOUR / METRES_PER_PX) * CRUISE_SHARE
}

/** Places the vehicle's point from its way, position and lateral offset. */
export function syncAt(vehicle: Vehicle): void {
  const { flow } = vehicle

  vehicle.at.x = flow.axis === 'x' ? vehicle.pos : flow.line
  vehicle.at.y = flow.axis === 'x' ? flow.line + vehicle.lateral : vehicle.pos
}

export function isTwoWheeler(kind: VehicleKind): boolean {
  return kind === 'motorbike' || kind === 'delivery' || kind === 'school'
}
