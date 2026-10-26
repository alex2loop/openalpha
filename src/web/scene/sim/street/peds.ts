import {
  arrive,
  boardIfDue,
  hopOn,
  leaveSeat,
  scheduleScenes,
  seedWaiters,
} from '@/web/scene/sim/street/ped-scenes'
import {
  addCrossing,
  addPoint,
  clearRoute,
  countOf,
  createPed,
  gaitOf,
  PAVEMENT,
  type Ped,
  type PedStep,
  type Peds,
  SIDE_WALKS,
  startOn,
  syncGait,
  syncWalkTick,
  takePed,
  WALK_REACH_PX,
  walkPed,
} from '@/web/scene/sim/street/ped-walk'
import { isWithin, sayOver } from '@/web/scene/sim/street/traffic'
import { WORLD } from '@/web/scene/types'
import { type RegionPack, shopDoorOf } from '@/web/scene/world/regions'
import { createRng, seedOf } from '@/web/scene/world/rng'
import { sideX } from '@/web/scene/world/street-layout'

const MAX_PEDS = 48
// Walkers wanted on the street by the page clock.
const PED_TARGETS = Object.freeze({ day: 11, quiet: 10, rush: 16, dayEdges: 8, night: 2 })
const DOOR_WALK_SHARE = 0.06
const WALKER_CHANCE = 0.1
// The routes a walker takes, as shares: the far pavement end to end, over the crossing and down
// the west side, back up and over, else along a side pavement.
const ROUTE_SHARES = Object.freeze({ along: 0.26, south: 0.42, north: 0.58 })
// Two walkers who pass this close stop 2 to 4 s and wave; then nobody greets for 25 to 60 s.
const GREET = Object.freeze({ dx: 5.5, dy: 3, holdMs: 2_000, holdSpan: 2_000, lane: 2 })
const GREET_GAP_MS = Object.freeze({ min: 25_000, span: 35_000 })
const GREET_CHECK_MS = 450
const HELLO_SHARE = 0.5

export function createPeds(): Peds {
  return {
    pool: Array.from({ length: MAX_PEDS }, createPed),
    tick: { dt: 0, nowMs: 0, canCross: false },
    rng: createRng(0),
    greetCheckAt: 0,
    greetReadyAt: 0,
  }
}

/** Rebuilds the walkers from the clock: the minute's walkers placed along their routes and the
 *  shelters' waiters, as a still if nothing steps. */
export function resetPeds(
  peds: Peds,
  at: {
    readonly pack: RegionPack
    readonly day: string
    readonly minute: number
    readonly nowMs: number
  }
): void {
  peds.rng = createRng(seedOf(at.day, at.pack.id, 'people', String(Math.floor(at.minute))))
  peds.greetReadyAt = at.nowMs

  for (const ped of peds.pool) {
    ped.on = false
  }

  for (let index = 0; index < targetOf(at.pack, at.minute); index++) {
    addWalker(peds, { pack: at.pack, minute: at.minute, nowMs: at.nowMs, isPlaced: true })
  }

  if (!isWithin(at.pack.hours.night, at.minute)) {
    seedWaiters(peds, { pack: at.pack, nowMs: at.nowMs })
  }

  for (const ped of peds.pool) {
    ped.frame = ped.on ? gaitOf(ped, at.nowMs) : 0
    ped.lastFrame = ped.frame
  }
}

/** One sim step: the clock's due people join, everyone walks, waits, boards, sits or greets. */
export function stepPeds(peds: Peds, at: PedStep): void {
  schedule(peds, at)

  syncWalkTick(peds.tick, at, Number.POSITIVE_INFINITY)

  for (const ped of peds.pool) {
    if (ped.on) {
      stepPed(peds, ped, at)
      syncGait(ped, at.nowMs)
    }
  }

  greet(peds, at)
}

// A walker joins while the street holds fewer than the clock wants; then the scenes.
function schedule(peds: Peds, at: PedStep): void {
  const { pack } = at.traffic

  if (countOf(peds, 'walker') < targetOf(pack, at.minute) && peds.rng.next() < WALKER_CHANCE) {
    addWalker(peds, { pack, minute: at.minute, nowMs: at.nowMs, isPlaced: false })
  }

  scheduleScenes(peds, at)
}

function targetOf(pack: RegionPack, minute: number): number {
  const { hours } = pack

  if (isWithin(hours.rush, minute)) {
    return PED_TARGETS.rush
  }

  if (isWithin(hours.night, minute)) {
    return PED_TARGETS.night
  }

  if (isWithin(hours.dayEdges, minute)) {
    return PED_TARGETS.dayEdges
  }

  return isWithin(hours.quiet, minute) ? PED_TARGETS.quiet : PED_TARGETS.day
}

function addWalker(
  peds: Peds,
  at: {
    readonly pack: RegionPack
    readonly minute: number
    readonly nowMs: number
    readonly isPlaced: boolean
  }
): void {
  const ped = takePed(peds, { x: 0, y: 0 })

  if (ped === undefined) {
    return
  }

  const isDoorWalk =
    isWithin(at.pack.hours.doorWalks, at.minute) && peds.rng.next() < DOOR_WALK_SHARE

  if (!(isDoorWalk && doorRoute(peds, ped, at.pack))) {
    walkRoute(peds, ped)
  }

  startOn(peds, ped, at)
}

function walkRoute(peds: Peds, ped: Ped): void {
  const { rng } = peds
  const roll = rng.next()
  const isEast = rng.next() < 0.5
  const west = -WALK_REACH_PX
  const east = WORLD.w + WALK_REACH_PX
  const [from, to] = isEast ? [west, east] : [east, west]
  const crossing = -SIDE_WALKS.near

  clearRoute(ped)

  if (roll < ROUTE_SHARES.along) {
    addPoint(ped, from, PAVEMENT.far)
    addPoint(ped, to, PAVEMENT.far)
  } else if (roll < ROUTE_SHARES.south) {
    addPoint(ped, from, PAVEMENT.far)
    addPoint(ped, crossing, PAVEMENT.far)
    addPoint(ped, crossing, PAVEMENT.farKerb)
    addCrossing(ped, crossing, PAVEMENT.nearKerb)
    addPoint(ped, crossing, PAVEMENT.south)
  } else if (roll < ROUTE_SHARES.north) {
    addPoint(ped, crossing, PAVEMENT.south)
    addPoint(ped, crossing, PAVEMENT.nearKerb)
    addCrossing(ped, crossing, PAVEMENT.farKerb)
    addPoint(ped, crossing, PAVEMENT.far)
    addPoint(ped, to, PAVEMENT.far)
  } else {
    sideRoute(peds, ped)
  }
}

// Up or down one of the four side pavements.
function sideRoute(peds: Peds, ped: Ped): void {
  const { rng } = peds
  const side = rng.next() < 0.5 ? -1 : 1
  const x = sideX(side, rng.next() < 0.5 ? SIDE_WALKS.near : SIDE_WALKS.far)
  const isNorthbound = rng.next() < 0.5

  addPoint(ped, x, isNorthbound ? PAVEMENT.south : PAVEMENT.sideTop)
  addPoint(ped, x, isNorthbound ? PAVEMENT.sideTop : PAVEMENT.south)
}

// Out of a door to one end of the far pavement, or along it and in at a door. Doors are every
// other front of the shop row.
function doorRoute(peds: Peds, ped: Ped, pack: RegionPack): boolean {
  const { rng } = peds
  const index = rng.int(0, Math.floor((pack.shops.length - 1) / 2)) * 2
  const row = pack.shops[index]

  if (row === undefined || row.kind === 'lobby') {
    return false
  }

  const door = shopDoorOf(pack.shops, index)
  const end = rng.next() < 0.5 ? -WALK_REACH_PX : WORLD.w + WALK_REACH_PX

  clearRoute(ped)

  if (rng.next() < 0.5) {
    addPoint(ped, door.x, PAVEMENT.door)
    addPoint(ped, door.x, PAVEMENT.far)
    addPoint(ped, end, PAVEMENT.far)
  } else {
    addPoint(ped, end, PAVEMENT.far)
    addPoint(ped, door.x, PAVEMENT.far)
    addPoint(ped, door.x, PAVEMENT.door)
  }

  return true
}

function stepPed(peds: Peds, ped: Ped, step: PedStep): void {
  ped.prev.x = ped.at.x
  ped.prev.y = ped.at.y

  if (ped.task === 'wait') {
    boardIfDue(ped, step.traffic)
    return
  }

  if (ped.task === 'pickup' && hopOn(ped)) {
    return
  }

  if (step.nowMs < ped.holdUntil) {
    return
  }

  if (ped.task === 'sit' && ped.routeLength === 0) {
    leaveSeat(ped)
  }

  if (walkPed(ped, peds.tick)) {
    arrive(peds, ped, step.nowMs)
  }
}

// Two walkers who pass close on the far pavement stop, turn and wave, one says hello half the
// time; then nobody greets for a while.
function greet(peds: Peds, at: PedStep): void {
  if (at.nowMs < peds.greetCheckAt || at.nowMs < peds.greetReadyAt) {
    return
  }

  peds.greetCheckAt = at.nowMs + GREET_CHECK_MS

  for (const a of peds.pool) {
    const b = a.on && isGreeter(a, at.nowMs) ? passerOf(peds, a, at.nowMs) : undefined

    if (b !== undefined) {
      wave(peds, { a, b, step: at })
      return
    }
  }
}

function wave(
  peds: Peds,
  pair: { readonly a: Ped; readonly b: Ped; readonly step: PedStep }
): void {
  const { a, b, step } = pair
  const until = step.nowMs + GREET.holdMs + peds.rng.next() * GREET.holdSpan

  a.holdUntil = until
  a.waveUntil = until
  b.holdUntil = until
  b.waveUntil = until
  a.facing = a.at.x < b.at.x ? 'east' : 'west'
  b.facing = a.facing === 'east' ? 'west' : 'east'
  peds.greetReadyAt = step.nowMs + GREET_GAP_MS.min + peds.rng.next() * GREET_GAP_MS.span

  if (peds.rng.next() < HELLO_SHARE) {
    sayOver(step.traffic, { by: a, chatter: 'hello', nowMs: step.nowMs })
  }
}

function isGreeter(ped: Ped, nowMs: number): boolean {
  return (
    ped.kind === 'walker' &&
    ped.task === 'walk' &&
    nowMs >= ped.holdUntil &&
    Math.abs(ped.at.y - PAVEMENT.far) < GREET.lane &&
    (ped.facing === 'east' || ped.facing === 'west')
  )
}

// Someone coming the other way, close and still ahead of `a`.
function passerOf(peds: Peds, a: Ped, nowMs: number): Ped | undefined {
  return peds.pool.find(
    (b) =>
      b !== a &&
      b.on &&
      isGreeter(b, nowMs) &&
      b.facing !== a.facing &&
      Math.abs(a.at.x - b.at.x) < GREET.dx &&
      Math.abs(a.at.y - b.at.y) < GREET.dy &&
      a.at.x < b.at.x === (a.facing === 'east')
  )
}
