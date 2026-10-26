import type { Flow, Vehicle } from '@/web/scene/sim/street/flows'
import type { StepWorld } from '@/web/scene/sim/street/traffic-step'
import type { RegionPack } from '@/web/scene/world/regions'
import { isTwoWheeler, syncAt } from '@/web/scene/sim/street/flows'
import { planTurn } from '@/web/scene/sim/street/traffic-step'
import { BIKE_SHAPES, CAR_SIZES, type CarSize, type VehicleKind } from '@/web/scene/types'

const SUN_COAT_SHARE = 0.22
const RIDE_HAILING_SHARE = 0.2
const PASSENGER_SHARE = 0.16
// On a habits street most motorbikes slip ahead of the cars; more in a jam.
const SQUEEZE_SHARE = 0.5
const SQUEEZE_JAM_SHARE = 0.35
const SPAWN_GAP_PX = 6
const EDGE_GAP_PX = 2
const PACE_FROM = 0.88
const PACE_SPAN = 0.24
/** A vehicle's look seed is drawn below this: enough bits for every colour a painter takes from it. */
export const LOOK_SEEDS = 0x4_00_00
// Length along the way and width across it, in world px.
const SIZES: Readonly<Record<Exclude<VehicleKind, 'car'> | CarSize, readonly [number, number]>> =
  Object.freeze({
    small: [8.4, 5.1],
    mid: [10.2, 5.4],
    large: [12.2, 5.9],
    taxi: [10.2, 5.4],
    bus: [22, 6.4],
    motorbike: [6, 2.4],
    delivery: [6, 2.4],
    school: [6, 2.4],
    sweeper: [4.6, 2.4],
    garbage: [14, 6],
  })

/** The traffic a vehicle joins: the step's world and the pack its looks come from. */
interface SpawnWorld extends StepWorld {
  readonly pack: RegionPack
}

/** What a new vehicle is and where it comes in; `pos` defaults to its way's entry. */
interface Spawn {
  readonly flow: Flow
  readonly kind: VehicleKind
  readonly pos?: number | undefined
  readonly stops?: readonly number[]
  readonly route?: string | undefined
}

export function vehicleSizeOf(vehicle: {
  readonly kind: VehicleKind
  readonly car: CarSize
}): readonly [number, number] {
  return SIZES[vehicle.kind === 'car' ? vehicle.car : vehicle.kind]
}

/** A new vehicle of `spec` at its way's entry, or where `spec` places it, when there is room. */
export function spawn(traffic: SpawnWorld, spec: Spawn): void {
  const vehicle = traffic.pool.find((candidate) => !candidate.on)

  if (vehicle === undefined) {
    return
  }

  dress(traffic, vehicle, spec.kind)

  const { flow } = spec
  const entry = flow.dir > 0 ? flow.from - vehicle.len / 2 : flow.to + vehicle.len / 2

  vehicle.pos = spec.pos ?? entry - flow.dir * EDGE_GAP_PX

  if (isClear(traffic.pool, { flow, pos: vehicle.pos, len: vehicle.len })) {
    place(traffic, vehicle, spec)
  }
}

function isClear(
  pool: readonly Vehicle[],
  at: { readonly flow: Flow; readonly pos: number; readonly len: number }
): boolean {
  for (const other of pool) {
    if (
      other.on &&
      other.flow === at.flow &&
      Math.abs(other.pos - at.pos) < at.len + other.len + SPAWN_GAP_PX
    ) {
      return false
    }
  }

  return true
}

// The look: size or shape from the pack's mix, the rider's gear and passenger, a colour seed.
function dress(traffic: SpawnWorld, vehicle: Vehicle, kind: VehicleKind): void {
  const { rng, pack } = traffic
  const mix = pack.vehicles

  vehicle.kind = kind
  vehicle.car = pickShare(CAR_SIZES, { shares: mix.carSizes, roll: rng.next() })
  vehicle.bike = pickShare(BIKE_SHAPES, { shares: mix.bikeShapes, roll: rng.next() })
  vehicle.look = rng.int(0, LOOK_SEEDS - 1)
  vehicle.gear = gearOf(kind, rng.next())
  vehicle.passenger = kind === 'school' || (kind === 'motorbike' && rng.next() < PASSENGER_SHARE)

  const [len, width] = vehicleSizeOf(vehicle)
  const squeezeShare = SQUEEZE_SHARE + SQUEEZE_JAM_SHARE * traffic.tick.jam

  vehicle.len = len
  vehicle.width = width
  vehicle.squeezes = isTwoWheeler(kind) && traffic.tick.habits && rng.next() < squeezeShare
  vehicle.column = rng.next() < 0.5 ? 1 : 2
}

function gearOf(kind: VehicleKind, roll: number): Vehicle['gear'] {
  if (kind === 'delivery' || (kind === 'motorbike' && roll >= 1 - RIDE_HAILING_SHARE)) {
    return 'rideHailing'
  }

  return kind === 'motorbike' && roll < SUN_COAT_SHARE ? 'sunCoat' : 'plain'
}

function place(traffic: SpawnWorld, vehicle: Vehicle, spec: Spawn): void {
  const { flow } = spec

  vehicle.on = true
  vehicle.flow = flow
  vehicle.heading = flow.heading
  vehicle.pace = PACE_FROM + traffic.rng.next() * PACE_SPAN
  vehicle.speed = flow.cruise * vehicle.pace * traffic.tick.pace
  vehicle.squeezes = vehicle.squeezes && flow.street === 'north' && spec.stops === undefined
  vehicle.lateral = vehicle.squeezes || vehicle.kind === 'sweeper' ? flow.columns[0] : 0
  vehicle.stops = spec.stops ?? []
  vehicle.stopIndex = 0
  vehicle.dwellUntil = 0
  vehicle.waitMs = 0
  vehicle.route = spec.route ?? ''
  vehicle.footDown = false
  vehicle.turnTo = flow === traffic.flows.turnOnto ? planTurn(traffic, vehicle) : undefined
  syncAt(vehicle)
  vehicle.prev.x = vehicle.at.x
  vehicle.prev.y = vehicle.at.y
}

// The key `roll` lands on as the shares add up; the last one past their sum.
function pickShare<K extends string>(
  keys: readonly [K, ...K[]],
  at: { readonly shares: Readonly<Record<K, number>>; readonly roll: number }
): K {
  let sum = 0

  for (const key of keys) {
    sum += at.shares[key]

    if (at.roll < sum) {
      return key
    }
  }

  return keys[keys.length - 1] ?? keys[0]
}

export function pickFrom<T>(rng: StepWorld['rng'], items: readonly T[]): T | undefined {
  return items[Math.floor(rng.next() * items.length)]
}

// An idle slot points at the first way until it is placed.
export function createVehicle(flow: Flow): Vehicle {
  return {
    on: false,
    flow,
    pos: 0,
    len: 0,
    width: 0,
    pace: 1,
    speed: 0,
    lateral: 0,
    column: 1,
    squeezes: false,
    stops: [],
    stopIndex: 0,
    dwellUntil: 0,
    turnTo: undefined,
    waitMs: 0,
    prev: { x: 0, y: 0 },
    at: { x: 0, y: 0 },
    kind: 'car',
    heading: 'east',
    car: 'mid',
    bike: 'scooter',
    gear: 'plain',
    passenger: false,
    look: 0,
    route: '',
    footDown: false,
  }
}
