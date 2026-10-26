import { PARKS, type Park, PLAY_SPOTS, type TrainSpot } from '@/web/scene/sim/street/park-layout'
import {
  addPath,
  addStreetLeg,
  createParkPed,
  enterRoute,
  leaveRoute,
  nodeOf,
  PARK_ROLES,
  type ParkPed,
  type ParkRole,
  placeAlong,
  placeAt,
  type Rng,
} from '@/web/scene/sim/street/park-ways'
import {
  addPoint,
  clearRoute,
  gaitOf,
  startOn,
  syncGait,
  takePed,
  type WalkTick,
  walkPed,
} from '@/web/scene/sim/street/ped-walk'
import {
  isWithin,
  type MinuteRanges,
  type RegionPack,
  type StreetHours,
} from '@/web/scene/world/regions'
import { createRng, seedOf } from '@/web/scene/world/rng'

/** Everyone in the four parks at once. */
const MAX_PARK_PEOPLE = 56
const JOIN_CHANCE = 0.03
// Wanted in each park: strollers and sitters all day and at the evening peak, joggers at their
// hours, the tai chi group and the gym by day and at their peak, children at the playground.
const WANTS = Object.freeze({
  stroll: { north: [3, 5], west: [2, 3], east: [2, 3], south: [2, 3] },
  sit: { north: [2, 3], west: [2, 3], east: [2, 3], south: [2, 2] },
  jog: { north: 3, west: 1, east: 1, south: 1 },
  taiChi: [1, 3],
  gym: [2, 5],
  kids: [2, 4],
} as const)
const JOG_PX_PER_S = 7.5
const KID_PACE = Object.freeze({ from: 3.1, span: 0.5 })
// A gym user's legs keep going on the machine at this many px a second.
const GYM_PX_PER_S = 3
const CUP_SHARE = 0.4
// How long each stays from arriving; placed by the clock, how much of it is left.
const STAY_MS = Object.freeze({
  sit: { min: 30_000, span: 90_000 },
  train: { min: 40_000, span: 80_000 },
  kid: { min: 60_000, span: 80_000 },
  placed: { min: 10_000, span: 90_000 },
})
const PLAY_HOLD_MS = Object.freeze({ min: 1_500, span: 3_500 })

/** The parks' one pool of people, the walk clock they share and the chance they draw on. */
export interface Parks {
  readonly pool: ParkPed[]
  readonly tick: WalkTick
  readonly counts: Int16Array
  rng: Rng
}

/** What a parks step reads: the pack, the page minute, sim time and the seconds stepped. */
interface ParkStep {
  readonly pack: RegionPack
  readonly minute: number
  readonly nowMs: number
  readonly dt: number
}

/** How long someone stays from `nowMs`. */
interface Stay {
  readonly nowMs: number
  readonly stayMs: { readonly min: number; readonly span: number }
}

/** Who joins: the park, the role, and whether the clock places them (else they come in). */
interface Join {
  readonly park: Park
  readonly role: ParkRole
  readonly nowMs: number
  readonly isPlaced: boolean
}

export function createParks(): Parks {
  return {
    pool: Array.from({ length: MAX_PARK_PEOPLE }, createParkPed),
    tick: { dt: 0, nowMs: 0, canCross: false },
    counts: new Int16Array(PARKS.length * PARK_ROLES.length),
    rng: createRng(0),
  }
}

/** Rebuilds the parks from the clock: the minute's people placed on benches, at the gym, the tai
 *  chi plaza and the playground, and along the paths, as a still if nothing steps. */
export function resetParks(
  parks: Parks,
  at: {
    readonly pack: RegionPack
    readonly day: string
    readonly minute: number
    readonly nowMs: number
  }
): void {
  parks.rng = createRng(seedOf(at.day, at.pack.id, 'park', String(Math.floor(at.minute))))

  for (const ped of parks.pool) {
    ped.on = false
  }

  for (const park of PARKS) {
    for (const role of PARK_ROLES) {
      for (let index = 0; index < wantOf(park, role, at); index++) {
        join(parks, { park, role, nowMs: at.nowMs, isPlaced: true })
      }
    }
  }

  for (const ped of parks.pool) {
    ped.frame = ped.on ? gaitOf(ped, at.nowMs) : 0
    ped.lastFrame = ped.frame
  }
}

/** One sim step: the clock's due people come in at the gates, everyone walks, sits, trains,
 *  plays or leaves. */
export function stepParks(parks: Parks, at: ParkStep): void {
  parks.tick.dt = at.dt
  parks.tick.nowMs = at.nowMs
  schedule(parks, at)

  for (const ped of parks.pool) {
    if (ped.on) {
      stepParkPed(parks, ped, at)
      syncGait(ped, at.nowMs)
    }
  }
}

// One more of a role joins a park while it holds fewer than the clock wants (anyone on the way
// out no longer counts).
function schedule(parks: Parks, at: ParkStep): void {
  const { counts } = parks

  counts.fill(0)

  for (const ped of parks.pool) {
    if (ped.on && ped.stage !== 'leave') {
      const slot = slotOf(PARKS.indexOf(ped.park), ped.role)

      counts[slot] = (counts[slot] ?? 0) + 1
    }
  }

  for (const [index, park] of PARKS.entries()) {
    for (const role of PARK_ROLES) {
      const isDue =
        (counts[slotOf(index, role)] ?? 0) < wantOf(park, role, at) &&
        parks.rng.next() < JOIN_CHANCE

      if (isDue) {
        join(parks, { park, role, nowMs: at.nowMs, isPlaced: false })
      }
    }
  }
}

function slotOf(park: number, role: ParkRole): number {
  return park * PARK_ROLES.length + PARK_ROLES.indexOf(role)
}

// Nobody while the parks are shut; more strollers and sitters at the evening peak.
function wantOf(
  park: Park,
  role: ParkRole,
  at: { readonly pack: RegionPack; readonly minute: number }
): number {
  const { hours } = at.pack
  const { minute } = at
  const { parks } = hours
  const peak = peakOf(parks.playgroundPeak, minute)

  if (!isWithin(parks.open, minute)) {
    return 0
  }

  switch (role) {
    case 'stroll':
      return WANTS.stroll[park.id][peak]
    case 'sit':
      return WANTS.sit[park.id][peak]
    case 'jog':
      return isWithin(parks.joggers, minute) ? WANTS.jog[park.id] : 0
    case 'train':
      return trainWantOf(park, hours, minute)
    case 'kid':
      return park.play !== undefined && isWithin(parks.playground, minute) ? WANTS.kids[peak] : 0
    default:
      return role satisfies never
  }
}

// The tai chi group in the early morning and one by day; the gym fuller at its peak.
function trainWantOf(park: Park, hours: StreetHours, minute: number): number {
  const first = park.spots[0]

  if (first === undefined) {
    return 0
  }

  if (first.isStill) {
    return WANTS.taiChi[peakOf(hours.parks.taiChi, minute)]
  }

  return WANTS.gym[peakOf(hours.parks.gymPeak, minute)]
}

function peakOf(ranges: MinuteRanges, minute: number): 0 | 1 {
  return isWithin(ranges, minute) ? 1 : 0
}

function join(parks: Parks, job: Join): void {
  const ped = takePed(parks, { x: 0, y: 0 })

  if (ped === undefined) {
    return
  }

  ped.park = job.park
  ped.role = job.role
  ped.seat = -1
  ped.stage = 'go'
  ped.until = 0

  if (!routeFor(parks, ped, job)) {
    ped.on = false
  }
}

// The way in for the role, or the clock's place for it; false when its bench or spot is taken.
function routeFor(parks: Parks, ped: ParkPed, job: Join): boolean {
  switch (job.role) {
    case 'sit':
      return goToBench(parks, ped, job)
    case 'train':
      return goToSpot(parks, ped, job)
    case 'kid':
      return goToPlay(parks, ped, job)
    default:
      walkThrough(parks, ped, job)
      return true
  }
}

// In at a gate, along the paths, and out at a gate: a stroll between two places, or the jog loop.
function walkThrough(parks: Parks, ped: ParkPed, job: Join): void {
  const { park } = job
  const { rng } = parks
  const isJog = job.role === 'jog'
  const turns = isJog ? park.loop : [nodeOf(rng, park.strolls), nodeOf(rng, park.strolls)]
  const exit = nodeOf(rng, park.gates)
  let node = enterRoute(rng, ped, job)

  for (const turn of turns) {
    node = addPath(ped, { from: node, to: turn })
  }

  addPath(ped, { from: node, to: exit })
  addStreetLeg(rng, ped, { gate: exit, isOut: true })

  if (isJog) {
    ped.kind = 'jogger'
    ped.speed = JOG_PX_PER_S
  }

  startAlong(parks, ped, job)
}

function goToBench(parks: Parks, ped: ParkPed, job: Join): boolean {
  const seat = freeSeatOf(parks, { park: job.park, role: job.role, count: job.park.benches.length })
  const bench = job.park.benches[seat]

  if (bench === undefined) {
    return false
  }

  ped.seat = seat

  if (job.isPlaced) {
    placeAt(ped, bench.at)
    sitDown(parks, ped, { nowMs: job.nowMs, stayMs: STAY_MS.placed })
  } else {
    goTo(parks, ped, { job, node: bench.node, at: bench.at })
  }

  return true
}

function goToSpot(parks: Parks, ped: ParkPed, job: Join): boolean {
  const seat = freeSeatOf(parks, { park: job.park, role: job.role, count: job.park.spots.length })
  const spot = job.park.spots[seat]

  if (spot === undefined) {
    return false
  }

  ped.seat = seat

  if (job.isPlaced) {
    placeAt(ped, spot.at)
    train(parks, ped, { spot, nowMs: job.nowMs, stayMs: STAY_MS.placed })
  } else {
    goTo(parks, ped, { job, node: spot.node, at: spot.at })
  }

  return true
}

function goToPlay(parks: Parks, ped: ParkPed, job: Join): boolean {
  const { play } = job.park
  const spot = parks.rng.pick(PLAY_SPOTS)

  if (play === undefined) {
    return false
  }

  ped.kind = 'pupil'
  ped.speed = KID_PACE.from + parks.rng.next() * KID_PACE.span
  ped.until = job.nowMs + STAY_MS.kid.min + parks.rng.next() * STAY_MS.kid.span

  if (job.isPlaced) {
    placeAt(ped, spot)
    ped.node = play
    ped.stage = 'stay'
    ped.holdUntil = job.nowMs + parks.rng.next() * PLAY_HOLD_MS.span
  } else {
    goTo(parks, ped, { job, node: play, at: spot })
  }

  return true
}

// In at a gate, along the paths to `node` and over to the place itself.
function goTo(
  parks: Parks,
  ped: ParkPed,
  to: { readonly job: Join; readonly node: number; readonly at: { x: number; y: number } }
): void {
  addPath(ped, { from: enterRoute(parks.rng, ped, to.job), to: to.node })
  addPoint(ped, to.at.x, to.at.y)
  startAlong(parks, ped, to.job)
}

// A bench or spot of the park nobody in the role has taken, or -1.
function freeSeatOf(
  parks: Parks,
  seats: { readonly park: Park; readonly role: ParkRole; readonly count: number }
): number {
  const { count } = seats
  const first = parks.rng.int(0, Math.max(0, count - 1))

  for (let index = 0; index < count; index++) {
    const seat = (first + index) % count
    const isTaken = parks.pool.some(
      (other) =>
        other.on && other.park === seats.park && other.role === seats.role && other.seat === seat
    )

    if (!isTaken) {
      return seat
    }
  }

  return -1
}

// From the street, or, placed by the clock, somewhere along the way.
function startAlong(parks: Parks, ped: ParkPed, job: Join): void {
  if (job.isPlaced) {
    placeAlong(parks.rng, ped, job.nowMs)
  } else {
    startOn(parks, ped, { nowMs: job.nowMs, isPlaced: false })
  }
}

function stepParkPed(parks: Parks, ped: ParkPed, step: ParkStep): void {
  if (ped.stage === 'stay') {
    stay(parks, ped, step)
    return
  }

  if (walkPed(ped, parks.tick)) {
    arrive(parks, ped, step.nowMs)
  }
}

// At the route's end: a walker through or anyone leaving is gone; the rest take their place.
function arrive(parks: Parks, ped: ParkPed, nowMs: number): void {
  const spot = ped.park.spots[ped.seat]

  if (ped.stage === 'leave' || ped.role === 'stroll' || ped.role === 'jog') {
    ped.on = false
  } else if (ped.role === 'sit') {
    sitDown(parks, ped, { nowMs, stayMs: STAY_MS.sit })
  } else if (ped.role === 'train' && spot !== undefined) {
    train(parks, ped, { spot, nowMs, stayMs: STAY_MS.train })
  } else {
    ped.stage = 'stay'
    ped.holdUntil = nowMs + PLAY_HOLD_MS.min + parks.rng.next() * PLAY_HOLD_MS.span
  }
}

function sitDown(parks: Parks, ped: ParkPed, at: Stay): void {
  const bench = ped.park.benches[ped.seat]

  clearRoute(ped)
  ped.stage = 'stay'
  ped.kind = 'sitter'
  ped.facing = (bench?.facing ?? 1) > 0 ? 'east' : 'west'
  ped.node = bench?.node ?? ped.node
  ped.until = at.nowMs + at.stayMs.min + parks.rng.next() * at.stayMs.span
  ped.item = parks.rng.next() < CUP_SHARE ? 'cup' : undefined
}

function train(parks: Parks, ped: ParkPed, at: Stay & { readonly spot: TrainSpot }): void {
  clearRoute(ped)
  ped.stage = 'stay'
  ped.facing = at.spot.facing
  ped.node = at.spot.node
  ped.until = at.nowMs + at.stayMs.min + parks.rng.next() * at.stayMs.span
}

// Sitting or tai chi holds still, the gym's legs keep going, a child runs to another piece; each
// leaves once their time is up.
function stay(parks: Parks, ped: ParkPed, step: ParkStep): void {
  const spot = ped.park.spots[ped.seat]

  if (step.nowMs < ped.holdUntil) {
    return
  }

  if (step.nowMs >= ped.until) {
    leave(parks, ped)
  } else if (ped.role === 'kid') {
    const next = parks.rng.pick(PLAY_SPOTS)

    clearRoute(ped)
    addPoint(ped, next.x, next.y)
    ped.stage = 'go'
  } else if (ped.role === 'train' && spot?.isStill === false) {
    ped.dist += step.dt * GYM_PX_PER_S
    ped.movedAt = step.nowMs
  }
}

function leave(parks: Parks, ped: ParkPed): void {
  leaveRoute(parks.rng, ped)
  ped.stage = 'leave'
  ped.seat = -1
  ped.item = undefined

  if (ped.kind === 'sitter') {
    ped.kind = 'walker'
  }
}
