import type { VehicleKind } from '@/web/scene/street-types'
import type { createRng } from '@/web/scene/world/rng'
import {
  type Flow,
  type Flows,
  isTwoWheeler,
  syncAt,
  type Vehicle,
} from '@/web/scene/sim/street/flows'
import { signalOf } from '@/web/scene/sim/street/signals'
import { CROSSING, JUNCTION, NORTH } from '@/web/scene/world/street-layout'
import { MS_PER_SECOND } from '@/web/text/time-units'

const BUS_DWELL_MS = 10_000
const DELIVERY_DWELL_MS = 9_000
const TURN_SHARE = 0.45
// Px a second each second: braking, a car pulling away, a motorbike pulling away first.
const BRAKE = 70
const CAR_PULL = 28
const BIKE_PULL = 46
// The gap kept behind the one ahead: cruising, slowed, slowed where motorbikes weave, bike to bike.
const GAP = Object.freeze({ cruise: 2.8, slow: 1.8, habits: 1.3, bikes: 0.9 })
// A slow sweeper or garbage truck, and a motorbike weaving through a jam.
const SLOW_PACE: Partial<Readonly<Record<VehicleKind, number>>> = Object.freeze({
  garbage: 0.38,
  sweeper: 0.12,
})
const SQUEEZE_JAM_PACE = 0.25
const ROOM_TO_SPEED = 1.5
// Inside one column across, a motorbike is held by the one ahead; a car only by one out of the
// kerb slot.
const COLUMN_W = 1.8
const KERB_FREE = 2.5
const COLUMN_PX_PER_S = 5
// A motorbike leaves the kerb slot for its column once the car ahead is this far off.
const CLEAR_OF_CARS = 12
const STOPPED_SPEED = 1.5
const WAITING_SPEED = 0.8
const AT_STOP_PX = 0.7
const PAST_LINE = -0.5
const TURN_SPEED = 12
const LEAVE_MARGIN = 4
const ENTRY_GAP = 3

type Rng = ReturnType<typeof createRng>

/** This step's clock and the street's mood: sim time, seconds stepped, page minute, a red held
 *  for a seeded queue, how jammed it is, the clock's pace and the pack's road habits. */
interface Tick {
  nowMs: number
  dt: number
  minute: number
  holdRed: boolean
  jam: number
  pace: number
  habits: boolean
}

/** What a step moves: the ways, the pool, the tick and the stream of chance a turn draws on. */
export interface StepWorld {
  readonly flows: Flows
  readonly pool: readonly Vehicle[]
  readonly tick: Tick
  readonly rng: Rng
}

/** Moves every vehicle one step along its way: behind the one ahead, at the lights, at its
 *  stops, through the junctions. */
export function stepFlows(world: StepWorld): void {
  for (const flow of world.flows.all) {
    fillQueue(world.pool, flow)
  }

  for (const flow of world.flows.all) {
    for (let index = 0; index < flow.queue.length; index++) {
      const vehicle = flow.queue[index]

      if (vehicle?.on && vehicle.flow === flow) {
        stepVehicle(world, { vehicle, index })
      }
    }
  }
}

/** A car on the way side streets turn onto may turn right into one ahead of it. */
export function planTurn(world: StepWorld, vehicle: Vehicle): Flow | undefined {
  const isLong = vehicle.kind === 'bus' || vehicle.kind === 'garbage' || vehicle.kind === 'sweeper'

  if (isLong || vehicle.stops.length > 0 || world.rng.next() > TURN_SHARE) {
    return undefined
  }

  const ahead = world.flows.all.filter(
    (flow) => flow.axis === 'y' && flow.dir > 0 && flow.line > vehicle.pos + vehicle.len / 2
  )

  return ahead[Math.floor(world.rng.next() * ahead.length)]
}

// The way's vehicles, front first.
function fillQueue(pool: readonly Vehicle[], flow: Flow): void {
  const { queue } = flow

  queue.length = 0

  for (const vehicle of pool) {
    if (!vehicle.on || vehicle.flow !== flow) {
      continue
    }

    let index = queue.length

    queue.push(vehicle)

    while (index > 0 && ((queue[index - 1]?.pos ?? 0) - vehicle.pos) * flow.dir < 0) {
      queue[index] = queue[index - 1] ?? vehicle
      index--
    }

    queue[index] = vehicle
  }
}

function stepVehicle(
  world: StepWorld,
  at: { readonly vehicle: Vehicle; readonly index: number }
): void {
  const { vehicle } = at
  const { tick } = world
  const was = vehicle.pos

  vehicle.prev.x = vehicle.at.x
  vehicle.prev.y = vehicle.at.y
  move(world, { vehicle, room: roomOf(world, at) })

  if (vehicle.squeezes && tick.habits) {
    weave(vehicle, { index: at.index, dt: tick.dt })
  }

  dwell(vehicle, tick.nowMs)
  syncAt(vehicle)
  leaveOrTurn(world, { vehicle, was })
}

// The free road ahead: behind the vehicle that holds it, at a red light, at its next stop, and
// clear of the junction.
function roomOf(
  world: StepWorld,
  at: { readonly vehicle: Vehicle; readonly index: number }
): number {
  const { vehicle } = at
  const { flow } = vehicle
  let room = leadRoom(world, at)

  room = Math.min(room, lightRoom(world, vehicle))

  const stop = vehicle.stops[vehicle.stopIndex]

  if (stop !== undefined) {
    room = upTo(room, (stop - vehicle.pos) * flow.dir)
  }

  if (flow === world.flows.turnOnto) {
    room = Math.min(room, junctionRoom(world, vehicle))
  } else if (flow.axis === 'y' && flow.dir < 0) {
    room = Math.min(room, sideRoom(world, vehicle))
  }

  return room
}

function leadRoom(
  world: StepWorld,
  at: { readonly vehicle: Vehicle; readonly index: number }
): number {
  const { vehicle } = at
  const { flow } = vehicle
  const habits = world.tick.habits && flow.street === 'north'

  for (let index = at.index - 1; index >= 0; index--) {
    const lead = flow.queue[index]

    if (
      lead === undefined ||
      lead.flow !== flow ||
      !lead.on ||
      !blocks(vehicle, { lead, habits })
    ) {
      continue
    }

    const bothBikes = habits && isTwoWheeler(vehicle.kind) && isTwoWheeler(lead.kind)

    return (
      (lead.pos - vehicle.pos) * flow.dir -
      lead.len / 2 -
      vehicle.len / 2 -
      (bothBikes ? GAP.bikes : gapOf(world.tick))
    )
  }

  return Number.POSITIVE_INFINITY
}

function gapOf(tick: Tick): number {
  if (tick.pace >= 1) {
    return GAP.cruise
  }

  return tick.habits ? GAP.habits : GAP.slow
}

// Whether `lead` holds `vehicle` up. Where motorbikes weave, a bike in the kerb slot passes the
// cars, and a car passes a bike there; the sweeper only ever holds what shares its line.
function blocks(
  vehicle: Vehicle,
  at: { readonly lead: Vehicle; readonly habits: boolean }
): boolean {
  const { lead } = at
  const isSweeper = vehicle.kind === 'sweeper' || lead.kind === 'sweeper'

  if (isSweeper) {
    return Math.abs(vehicle.lateral - lead.lateral) < COLUMN_W
  }

  if (!at.habits || isWide(vehicle.kind) || isWide(lead.kind)) {
    return true
  }

  const isBike = isTwoWheeler(vehicle.kind)
  const isLeadBike = isTwoWheeler(lead.kind)

  if (isBike && isLeadBike) {
    return Math.abs(vehicle.lateral - lead.lateral) < COLUMN_W
  }

  if (isBike) {
    return Math.abs(vehicle.lateral) < KERB_FREE
  }

  return !isLeadBike || Math.abs(lead.lateral) < KERB_FREE
}

function isWide(kind: VehicleKind): boolean {
  return kind === 'bus' || kind === 'garbage'
}

// The north street's stop line on red: the cars' one, or the motorbikes' nearer the crossing.
function lightRoom(world: StepWorld, vehicle: Vehicle): number {
  const { flow } = vehicle
  const isGo = !world.tick.holdRed && signalOf('north', world.tick.nowMs).lamp === 'green'

  if (flow.street !== 'north' || isGo) {
    return Number.POSITIVE_INFINITY
  }

  const line = CROSSING.x - flow.dir * (vehicle.squeezes ? CROSSING.bikeLine : CROSSING.carLine)

  return upTo(
    Number.POSITIVE_INFINITY,
    (line - (vehicle.pos + (flow.dir * vehicle.len) / 2)) * flow.dir
  )
}

// On the way side streets turn onto, a vehicle stops short of a side vehicle still in the
// junction.
function junctionRoom(world: StepWorld, vehicle: Vehicle): number {
  let room = Number.POSITIVE_INFINITY

  for (const side of world.pool) {
    if (!isInJunction(side)) {
      continue
    }

    const half = side.width / 2 + vehicle.len / 2 + JUNCTION.gap

    room = upTo(room, (side.flow.line - half - vehicle.pos) * vehicle.flow.dir)
  }

  return room
}

function isInJunction(vehicle: Vehicle): boolean {
  const { flow } = vehicle
  const tail = vehicle.pos + vehicle.len / 2
  const head = vehicle.pos - vehicle.len / 2

  return (
    vehicle.on &&
    flow.axis === 'y' &&
    flow.dir < 0 &&
    head < NORTH.roadBottom + JUNCTION.gap &&
    tail > NORTH.roadBottom - JUNCTION.depth
  )
}

// A side vehicle heading for the north street waits at its line on red, and at the junction
// mouth while a north vehicle crosses the space it would take.
function sideRoom(world: StepWorld, vehicle: Vehicle): number {
  const head = vehicle.pos - vehicle.len / 2
  const mouth = head - (NORTH.roadBottom + JUNCTION.gap)
  let room = Number.POSITIVE_INFINITY

  if (isNearBandTaken(world, vehicle)) {
    room = upTo(room, mouth)
  }

  if (signalOf('side', world.tick.nowMs).lamp !== 'green') {
    room = upTo(room, mouth - JUNCTION.stopLine)
  }

  return room
}

function isNearBandTaken(world: StepWorld, vehicle: Vehicle): boolean {
  const onto = world.flows.turnOnto
  const x = vehicle.flow.line

  for (const other of world.pool) {
    if (
      other.on &&
      other.flow === onto &&
      Math.abs(other.pos - x) < other.len / 2 + vehicle.len / 2 + JUNCTION.gap
    ) {
      return true
    }
  }

  return false
}

// Room only counts while the line or stop is ahead, or just behind.
function upTo(room: number, distance: number): number {
  return distance >= PAST_LINE ? Math.min(room, distance) : room
}

function move(world: StepWorld, at: { readonly vehicle: Vehicle; readonly room: number }): void {
  const { vehicle } = at
  const { tick } = world
  const room = Math.max(0, at.room)
  const isBike = isTwoWheeler(vehicle.kind)
  const weaves = vehicle.squeezes && tick.habits ? 1 + SQUEEZE_JAM_PACE * tick.jam : 1
  const cruise =
    vehicle.flow.cruise * vehicle.pace * tick.pace * (SLOW_PACE[vehicle.kind] ?? 1) * weaves
  const want = Math.min(cruise, room * ROOM_TO_SPEED)
  const pull = isBike ? BIKE_PULL : CAR_PULL

  vehicle.speed += Math.min(pull * tick.dt, Math.max(-BRAKE * tick.dt, want - vehicle.speed))
  vehicle.pos += vehicle.flow.dir * Math.min(vehicle.speed * tick.dt, room)
  vehicle.waitMs = vehicle.speed < WAITING_SPEED ? vehicle.waitMs + tick.dt * MS_PER_SECOND : 0
  vehicle.footDown = isBike && vehicle.speed < STOPPED_SPEED
}

// A weaving motorbike keeps to the kerb slot while cars are close ahead, and moves out to its own
// column once they are clear and the column is free.
function weave(vehicle: Vehicle, at: { readonly index: number; readonly dt: number }): void {
  const { flow } = vehicle
  const column = flow.columns[vehicle.column]
  const reach = COLUMN_PX_PER_S * at.dt
  const isOut =
    vehicle.column > 0 &&
    carGapAhead(vehicle, at.index) > CLEAR_OF_CARS &&
    isColumnFree(vehicle, column)
  const target = isOut ? column : flow.columns[0]

  vehicle.lateral += Math.max(-reach, Math.min(reach, target - vehicle.lateral))
}

function carGapAhead(vehicle: Vehicle, index: number): number {
  const { flow } = vehicle
  let gap = Number.POSITIVE_INFINITY

  for (let ahead = index - 1; ahead >= 0; ahead--) {
    const other = flow.queue[ahead]

    if (other === undefined || isTwoWheeler(other.kind) || other.flow !== flow) {
      continue
    }

    const between = (other.pos - vehicle.pos) * flow.dir - other.len / 2 - vehicle.len / 2

    if (between > -1) {
      gap = Math.min(gap, between)
    }
  }

  return gap
}

function isColumnFree(vehicle: Vehicle, column: number): boolean {
  for (const other of vehicle.flow.queue) {
    const isBeside =
      other !== vehicle &&
      isTwoWheeler(other.kind) &&
      Math.abs(other.lateral - column) < COLUMN_W &&
      Math.abs(other.pos - vehicle.pos) < (other.len + vehicle.len) / 2

    if (isBeside) {
      return false
    }
  }

  return true
}

// At a stop: wait out the dwell, then make for the next one.
function dwell(vehicle: Vehicle, nowMs: number): void {
  const stop = vehicle.stops[vehicle.stopIndex]
  const isAtStop =
    stop !== undefined && Math.abs(stop - vehicle.pos) < AT_STOP_PX && vehicle.speed < STOPPED_SPEED

  if (!isAtStop) {
    return
  }

  if (vehicle.dwellUntil === 0) {
    vehicle.dwellUntil = nowMs + (vehicle.kind === 'bus' ? BUS_DWELL_MS : DELIVERY_DWELL_MS)
  } else if (nowMs > vehicle.dwellUntil) {
    vehicle.stopIndex++
    vehicle.dwellUntil = 0
  }
}

// Off past its way's end, or round a corner: a side vehicle turns right onto the north street,
// and a north vehicle turns right into the side street it planned.
function leaveOrTurn(
  world: StepWorld,
  at: { readonly vehicle: Vehicle; readonly was: number }
): void {
  const { vehicle } = at
  const { flow } = vehicle
  const half = vehicle.len / 2
  const onto = world.flows.turnOnto

  if (
    vehicle.pos < flow.from - half - LEAVE_MARGIN ||
    vehicle.pos > flow.to + half + LEAVE_MARGIN
  ) {
    vehicle.on = false
    return
  }

  if (
    flow.axis === 'y' &&
    flow.dir < 0 &&
    onto !== undefined &&
    vehicle.pos - half <= onto.line - JUNCTION.reach
  ) {
    turn(vehicle, { flow: onto, pos: flow.line })
    vehicle.turnTo = planTurn(world, vehicle)
    return
  }

  const into = vehicle.turnTo

  if (into !== undefined && at.was < into.line && vehicle.pos >= into.line) {
    turnInto(world, { vehicle, into })
  }
}

function turnInto(world: StepWorld, at: { readonly vehicle: Vehicle; readonly into: Flow }): void {
  const { vehicle, into } = at
  const pos = (world.flows.turnOnto?.line ?? NORTH.roadBottom) - JUNCTION.reach + vehicle.len / 2
  const isTaken = world.pool.some(
    (other) =>
      other.on &&
      other !== vehicle &&
      other.flow === into &&
      Math.abs(other.pos - pos) < (other.len + vehicle.len) / 2 + ENTRY_GAP
  )

  vehicle.turnTo = undefined

  if (!isTaken) {
    turn(vehicle, { flow: into, pos })
  }
}

function turn(vehicle: Vehicle, to: { readonly flow: Flow; readonly pos: number }): void {
  vehicle.flow = to.flow
  vehicle.heading = to.flow.heading
  vehicle.pos = to.pos
  vehicle.speed = Math.min(vehicle.speed, TURN_SPEED)
  vehicle.lateral = 0
  vehicle.squeezes = false
  syncAt(vehicle)
}
