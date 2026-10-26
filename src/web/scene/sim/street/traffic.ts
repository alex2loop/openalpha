import type { StreetSayView, VehicleKind } from '@/web/scene/street-types'
import { type Flow, flowsOf, type StreetId, type Vehicle } from '@/web/scene/sim/street/flows'
import { createVehicle, pickFrom, spawn } from '@/web/scene/sim/street/spawn'
import { type StepWorld, stepFlows } from '@/web/scene/sim/street/traffic-step'
import {
  isInRange,
  isShopOpen,
  type MinuteRanges,
  type RegionPack,
  shopDoorOf,
} from '@/web/scene/world/regions'
import { createRng, seedOf } from '@/web/scene/world/rng'
import { MINUTES_PER_DAY, MS_PER_SECOND } from '@/web/text/time-units'

const MAX_VEHICLES = 22
const MAX_SAYS = 2
const MAX_DELIVERIES = 2
const CHATTER_GAP_MS = 26_000
const SAY_MS = 2_400
// A honk comes from someone held this long.
const HONK_WAIT_MS = 1_000
// A step longer than this (a stalled tab) moves no further.
const MAX_STEP_S = 0.25
// Vehicles wanted on the street by the page clock; the midday lull takes some off the day's.
const TARGETS = Object.freeze({ day: 14, rush: 20, dayEdges: 9, night: 3 })
const QUIET_DROP = 8
// A full jam fills the pool.
const JAM_EXTRA = MAX_VEHICLES - TARGETS.rush
const JAM_RAMP_MIN = 20
// The rush slows everyone, a jam more; the lull is a little quicker.
const RUSH_PACE = 0.7
const JAM_PACE = 0.38
const PLAIN_RUSH_PACE = 0.62
const QUIET_PACE = 1.1
// Where a new vehicle comes in: the north street, else the west side street, else the east one.
const NORTH_ODDS = 0.54
const WEST_ODDS = 0.5
// The chance a step adds one more of each, when one is due.
const CHANCES = Object.freeze({
  spawn: 0.5,
  garbage: 0.03,
  sweeper: 0.05,
  delivery: 0.012,
  school: 0.012,
  honk: 0.03,
  jamHonk: 0.12,
})
const BUS_EVERY_MIN = 7
const NEAR_BUS_OFFSET_MIN = 3
// A jam at the start is played forward with the light held, so its queue stands.
const SEED_STEPS = 60
const SEED_STEP_S = 0.2
const SEED_FROM_JAM = 0.2

interface Say extends StreetSayView {
  by: Vehicle | undefined
  until: number
  readonly at: { x: number; y: number }
}

/** The traffic's own state: the pack, the pool, the words said, and what the last step shows. */
export interface Traffic extends StepWorld {
  pack: RegionPack
  flows: StepWorld['flows']
  rng: StepWorld['rng']
  /** The vehicles on the street, north to south. */
  readonly shown: Vehicle[]
  readonly says: readonly Say[]
  readonly saying: Say[]
  lastSayAt: number
  readonly busMinutes: number[]
}

export function createTraffic(pack: RegionPack): Traffic {
  const flows = flowsOf(pack)

  return {
    pack,
    flows,
    rng: createRng(0),
    pool: Array.from({ length: MAX_VEHICLES }, () => createVehicle(flows.all[0])),
    shown: [],
    says: Array.from({ length: MAX_SAYS }, createSay),
    saying: [],
    tick: { nowMs: 0, dt: 0, minute: 0, holdRed: false, jam: 0, pace: 1, habits: false },
    lastSayAt: Number.NEGATIVE_INFINITY,
    busMinutes: flows.north.map(() => -1),
  }
}

/** Rebuilds the traffic from the clock: the day's seed, the vehicles the minute wants placed
 *  along the ways, and in a jam a queue played forward with the light held. */
export function resetTraffic(
  traffic: Traffic,
  at: {
    readonly pack: RegionPack
    readonly day: string
    readonly minute: number
    readonly nowMs: number
  }
): void {
  traffic.pack = at.pack
  traffic.flows = flowsOf(at.pack)
  traffic.rng = createRng(seedOf(at.day, at.pack.id, 'vehicles', String(Math.floor(at.minute))))
  traffic.lastSayAt = Number.NEGATIVE_INFINITY
  traffic.busMinutes.length = 0
  traffic.busMinutes.push(...traffic.flows.north.map(() => -1))

  for (const vehicle of traffic.pool) {
    vehicle.on = false
  }

  for (const say of traffic.says) {
    say.by = undefined
  }

  syncTick(traffic, at)
  placeTraffic(traffic, at.minute)
  syncShown(traffic, at.nowMs)
}

function placeTraffic(traffic: Traffic, minute: number): void {
  const want = targetOf(traffic.pack, minute)

  for (let tries = 0; countOn(traffic.pool) < want && tries < want * 3; tries++) {
    spawnAny(traffic, true)
  }

  if (!traffic.tick.habits || traffic.tick.jam <= SEED_FROM_JAM) {
    return
  }

  traffic.tick.holdRed = true
  traffic.tick.dt = SEED_STEP_S

  for (let index = 0; index < SEED_STEPS; index++) {
    stepFlows(traffic)
  }

  traffic.tick.holdRed = false
}

/** One sim step: the clock's due vehicles join, every way moves, and the shown lists follow. */
export function stepTraffic(
  traffic: Traffic,
  at: { readonly minute: number; readonly nowMs: number }
): void {
  const dt = Math.min(MAX_STEP_S, Math.max(0, (at.nowMs - traffic.tick.nowMs) / MS_PER_SECOND))

  syncTick(traffic, at)
  traffic.tick.dt = dt
  schedule(traffic, at.minute)
  stepFlows(traffic)
  sayHonk(traffic, at.nowMs)
  syncShown(traffic, at.nowMs)
}

/** A vehicle's length along its way and width across it. */
function syncTick(traffic: Traffic, at: { readonly minute: number; readonly nowMs: number }): void {
  const { tick, pack } = traffic

  tick.nowMs = at.nowMs
  tick.minute = at.minute
  tick.habits = pack.road.habits
  tick.jam = tick.habits ? jamOf(pack.hours.rush, at.minute) : 0
  tick.pace = paceOf(pack, at.minute, tick.jam)
}

// How jammed the rush is, 0 to 1, ramping in and out over `JAM_RAMP_MIN` at each end.
function jamOf(rush: MinuteRanges, minute: number): number {
  let jam = 0

  for (const [from, to] of rush) {
    if (minute >= from && minute < to) {
      jam = Math.max(jam, Math.min(1, (minute - from) / JAM_RAMP_MIN, (to - minute) / JAM_RAMP_MIN))
    }
  }

  return jam
}

function paceOf(pack: RegionPack, minute: number, jam: number): number {
  if (isWithin(pack.hours.rush, minute)) {
    return pack.road.habits ? RUSH_PACE - JAM_PACE * jam : PLAIN_RUSH_PACE
  }

  return isWithin(pack.hours.quiet, minute) ? QUIET_PACE : 1
}

function targetOf(pack: RegionPack, minute: number): number {
  const { hours } = pack

  if (isWithin(hours.rush, minute)) {
    return Math.min(MAX_VEHICLES, TARGETS.rush + Math.round(jamOf(hours.rush, minute) * JAM_EXTRA))
  }

  if (isWithin(hours.night, minute)) {
    return TARGETS.night
  }

  if (isWithin(hours.dayEdges, minute)) {
    return TARGETS.dayEdges
  }

  return isWithin(hours.quiet, minute) ? TARGETS.day - QUIET_DROP : TARGETS.day
}

function isWithin(ranges: MinuteRanges, minute: number): boolean {
  const at = minute % MINUTES_PER_DAY

  for (const range of ranges) {
    if (isInRange(at, range)) {
      return true
    }
  }

  return false
}

// The clock's due vehicles: the traffic it wants, the garbage truck and the sweeper along the
// near kerb, the school run, deliveries and the buses.
function schedule(traffic: Traffic, minute: number): void {
  const { pack, rng, flows } = traffic
  const { hours } = pack
  const near = flows.turnOnto

  if (countOn(traffic.pool) < targetOf(pack, minute) && rng.next() < CHANCES.spawn) {
    spawnAny(traffic, false)
  }

  if (near !== undefined && isDue(traffic, { hours: hours.garbage, kind: 'garbage', max: 1 })) {
    spawn(traffic, { flow: near, kind: 'garbage' })
  }

  if (near !== undefined && isDue(traffic, { hours: hours.sweeper, kind: 'sweeper', max: 1 })) {
    spawn(traffic, { flow: near, kind: 'sweeper' })
  }

  const schoolWay = pickFrom(rng, flows.north)

  if (schoolWay !== undefined && isDue(traffic, { hours: hours.school, kind: 'school', max: 1 })) {
    spawn(traffic, { flow: schoolWay, kind: 'school' })
  }

  if (isDue(traffic, { hours: hours.deliveries, kind: 'delivery', max: MAX_DELIVERIES })) {
    spawnDelivery(traffic, minute)
  }

  scheduleBuses(traffic, minute)
}

function isDue(
  traffic: Traffic,
  due: {
    readonly hours: MinuteRanges
    readonly kind: 'garbage' | 'sweeper' | 'school' | 'delivery'
    readonly max: number
  }
): boolean {
  return (
    isWithin(due.hours, traffic.tick.minute) &&
    countKind(traffic.pool, due.kind) < due.max &&
    traffic.rng.next() < CHANCES[due.kind]
  )
}

// A bus every `BUS_EVERY_MIN` page minutes each way, outside the night, calling at its stops.
function scheduleBuses(traffic: Traffic, minute: number): void {
  const whole = Math.floor(minute)

  if (isWithin(traffic.pack.hours.night, minute)) {
    return
  }

  for (const [index, flow] of traffic.flows.north.entries()) {
    const offset = flow.dir > 0 ? NEAR_BUS_OFFSET_MIN : 0
    const isDueNow = whole % BUS_EVERY_MIN === offset && traffic.busMinutes[index] !== whole

    if (isDueNow && flow.stops.length > 0) {
      traffic.busMinutes[index] = whole
      spawn(traffic, { flow, kind: 'bus', stops: flow.stops, route: pickRoute(traffic, flow) })
    }
  }
}

// A rider brings an order to an open shop that hands things over, stopping by its door.
function spawnDelivery(traffic: Traffic, minute: number): void {
  const flow = traffic.flows.north[0]
  const { shops } = traffic.pack
  const doors = shops.flatMap((row, index) =>
    row.item !== undefined && isShopOpen(row, minute) ? [shopDoorOf(shops, index).x] : []
  )
  const door = pickFrom(traffic.rng, doors)

  if (flow !== undefined && door !== undefined) {
    spawn(traffic, { flow, kind: 'delivery', stops: [door] })
  }
}

// The north street's traffic takes either way at random; a side street's own traffic comes in
// from its far end, heading for the north street, and only a placed one may stand on either way.
function spawnAny(traffic: Traffic, isPlaced: boolean): void {
  const { rng, flows } = traffic
  const street = pickStreet(rng)
  const ways = flows.all.filter((way) => way.street === street)
  const isEitherWay = isPlaced || street === 'north'
  const flow = isEitherWay ? pickFrom(rng, ways) : (ways.find((way) => way.dir < 0) ?? ways[0])

  if (flow === undefined) {
    return
  }

  const kind = pickKind(traffic)

  spawn(traffic, {
    flow,
    kind,
    pos: isPlaced ? flow.from + rng.next() * (flow.to - flow.from) : undefined,
    stops: kind === 'bus' ? flow.stops : undefined,
    route: kind === 'bus' ? pickRoute(traffic, flow) : undefined,
  })
}

function pickStreet(rng: StepWorld['rng']): StreetId {
  if (rng.next() < NORTH_ODDS) {
    return 'north'
  }

  return rng.next() < WEST_ODDS ? 'west' : 'east'
}

function pickKind(traffic: Traffic): VehicleKind {
  const { kinds, taxiShare } = traffic.pack.vehicles
  const roll = traffic.rng.next()

  if (roll < kinds.motorbike) {
    return 'motorbike'
  }

  if (roll < kinds.motorbike + kinds.car) {
    return traffic.rng.next() < taxiShare ? 'taxi' : 'car'
  }

  return 'bus'
}

function pickRoute(traffic: Traffic, flow: Flow): string {
  const routes =
    flow.routes.length > 0 ? flow.routes : traffic.flows.north.flatMap((way) => way.routes)

  return pickFrom(traffic.rng, routes) ?? ''
}

// More honks in a jam, never closer than `CHATTER_GAP_MS`, from someone held up.
function sayHonk(traffic: Traffic, nowMs: number): void {
  const chance = CHANCES.honk + CHANCES.jamHonk * traffic.tick.jam
  const say = freeSayOf(traffic.says)

  if (
    say === undefined ||
    nowMs - traffic.lastSayAt < CHATTER_GAP_MS ||
    traffic.rng.next() >= chance
  ) {
    return
  }

  const by = traffic.pool.find((vehicle) => vehicle.on && vehicle.waitMs >= HONK_WAIT_MS)

  if (by !== undefined) {
    say.by = by
    say.until = nowMs + SAY_MS
    traffic.lastSayAt = nowMs
  }
}

function freeSayOf(says: readonly Say[]): Say | undefined {
  for (const say of says) {
    if (say.by === undefined) {
      return say
    }
  }

  return undefined
}

// The vehicles north to south (the order they are drawn in), and the words still said.
function syncShown(traffic: Traffic, nowMs: number): void {
  const { shown, saying } = traffic

  shown.length = 0
  saying.length = 0

  for (const vehicle of traffic.pool) {
    if (vehicle.on) {
      insertByY(shown, vehicle)
    }
  }

  for (const say of traffic.says) {
    if (say.by !== undefined && (!say.by.on || nowMs >= say.until)) {
      say.by = undefined
    }

    if (say.by !== undefined) {
      say.at.x = say.by.at.x
      say.at.y = say.by.at.y
      saying.push(say)
    }
  }
}

function insertByY(shown: Vehicle[], vehicle: Vehicle): void {
  let index = shown.length

  shown.push(vehicle)

  while (index > 0 && (shown[index - 1]?.at.y ?? 0) > vehicle.at.y) {
    shown[index] = shown[index - 1] ?? vehicle
    index--
  }

  shown[index] = vehicle
}

function countOn(pool: readonly Vehicle[]): number {
  let count = 0

  for (const vehicle of pool) {
    count += vehicle.on ? 1 : 0
  }

  return count
}

function countKind(pool: readonly Vehicle[], kind: VehicleKind): number {
  let count = 0

  for (const vehicle of pool) {
    count += vehicle.on && vehicle.kind === kind ? 1 : 0
  }

  return count
}

function createSay(): Say {
  return { by: undefined, until: 0, at: { x: 0, y: 0 }, chatter: 'honk' }
}
