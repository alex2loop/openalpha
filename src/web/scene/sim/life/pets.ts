import type { FishView, PetKind, PetPose, PetView, Point } from '@/web/scene/types'
import { isAmbientBout, nextAmbientAt } from '@/web/scene/sim/actors/poses'
import {
  isPersonNear,
  isPersonOnLine,
  NODE_IDS,
  NODES,
  type NodeId,
  PERCHES,
  type Perch,
  routeOf,
  type Spot,
} from '@/web/scene/sim/life/pet-paths'
import { createRng, seedOf } from '@/web/scene/world/rng'
import { MS_PER_SECOND } from '@/web/text/time-units'

/** One piece of a pet's routine, from `t0` to `t1` (`performance.now()` instants). */
interface Leg {
  readonly kind: 'idle' | 'walk' | 'jump'
  readonly t0: number
  t1: number
  readonly from: Spot
  readonly to: Spot
  readonly pose: PetPose
  readonly isFlipped: boolean
  readonly perch?: Perch
}

interface PetState {
  readonly kind: PetKind
  legs: Leg[]
  end: number
  node: NodeId | undefined
  near: NodeId
  spot: Spot
  isFlipped: boolean
  perch: Perch | undefined
  draws: number
  prev: Point
}

interface FishState {
  readonly pool: string
  readonly depth: number
  u: number
  bob: number
}

/** What a pet's step reads: where the office's people stand, the office being quiet (the corgi
 *  sleeps), the cat woken, and reduced motion (everyone keeps still at home). */
interface PetWorld {
  readonly nowMs: number
  readonly dtMs: number
  readonly people: readonly Point[]
  readonly isQuiet: boolean
  readonly isCatAwake: boolean
  readonly isReduced: boolean
}

/** The pets and the fish, stepped with the sim. */
export interface Pets {
  /** True while a pet walks or jumps. */
  step(world: PetWorld): boolean
  /** A fish swims now: small motion, drawn at the capped rate. */
  isSwimming(world: PetWorld): boolean
  views(world: PetWorld): readonly PetView[]
  fish(): readonly FishView[]
  /** The next leg or bout to begin, a `performance.now()` instant; a pet keeping still asks for
   *  none. */
  nextDueAt(world: PetWorld): number
}

const HOMES: Readonly<Record<PetKind, NodeId>> = Object.freeze({ cat: 'bed', corgi: 'home' })
const REST_POSES: Readonly<Record<PetKind, PetPose>> = Object.freeze({ cat: 'sleep', corgi: 'lie' })
const PX_PER_S: Readonly<Record<PetKind, number>> = Object.freeze({ cat: 20, corgi: 16 })
const JUMP_MS: Readonly<Record<PetKind, number>> = Object.freeze({ cat: 650, corgi: 850 })
const PERCH_CHANCE: Readonly<Record<PetKind, number>> = Object.freeze({ cat: 0.24, corgi: 0.08 })
const WANDER_CHANCE = 0.5
const PERCH_STAY_MS = Object.freeze({ min: 14_000, max: 32_000 })
const WANDER_STAY_MS = Object.freeze({ min: 3_000, max: 9_000 })
const IDLE_STAY_MS = Object.freeze({ min: 4_000, max: 10_000 })
const STARTLED_MS = 2_500
// Back from a long spell without steps, a pet starts its routine afresh where it is.
const STALE_MS = 20_000
const LEG_KEEP_MS = 2_000
const MAX_LEGS = 48
const MAX_DECISIONS = 40
const MAX_DRAWS = 1_000_000
const PERSON_CLEAR_PX = 8
const JUMP_ARC_PX = 6
const PET_POOL = 'pet'
const FISH_POOL = 'fish'
const FISH_DEPTHS = [0.25, 0.5, 0.75] as const
// One sweep across the tank and back is two units of `u`.
const FISH_SWEEP_PER_MS = 1 / 6_000
const FISH_BOB_MS = 700
const FISH_BOB_DEPTH = 0.06

export function createPets(nowMs: number): Pets {
  const pets = (['cat', 'corgi'] as const).map((kind) => createPetState(kind, nowMs))
  const fish: FishState[] = FISH_DEPTHS.map((depth, i) => ({
    pool: `${FISH_POOL}:${i}`,
    depth,
    u: i * 0.6,
    bob: 0,
  }))

  return {
    step: (world) => {
      for (const one of fish) {
        stepFish(one, world)
      }

      return pets.map((pet) => stepPet(pet, world)).some(Boolean)
    },
    isSwimming: (world) =>
      !world.isReduced && fish.some((one) => isAmbientBout(one.pool, world.nowMs)),
    views: (world) => pets.map((pet) => toPetView(pet, world)),
    fish: () => fish.map(toFishView),
    nextDueAt: (world) => {
      const petDues = pets
        .filter((pet) => !isStill(pet, world) && pet.end > world.nowMs)
        .map((pet) => pet.end)
      const fishDues = world.isReduced
        ? []
        : fish.map((one) => nextAmbientAt(one.pool, world.nowMs))

      return Math.min(...petDues, ...fishDues, Number.POSITIVE_INFINITY)
    },
  }
}

function createPetState(kind: PetKind, nowMs: number): PetState {
  const node = HOMES[kind]
  const spot = NODES[node]
  const pet: PetState = {
    kind,
    legs: [],
    end: nowMs,
    node,
    near: node,
    spot,
    isFlipped: false,
    perch: undefined,
    draws: 0,
    prev: spot,
  }

  pushIdle(pet, { ms: STARTLED_MS, pose: REST_POSES[kind] })

  return pet
}

// Plans the routine up to now, cuts it short around people, and drops legs long over.
function stepPet(pet: PetState, world: PetWorld): boolean {
  const now = world.nowMs

  pet.prev = toPetView(pet, world).at

  if (isStill(pet, world)) {
    sendHome(pet, now)

    return false
  }

  if (now - pet.end > STALE_MS) {
    pet.legs = []
    pet.end = now
    pushIdle(pet, { ms: STARTLED_MS, pose: REST_POSES[pet.kind] })
  }

  for (let i = 0; pet.end <= now && i < MAX_DECISIONS; i++) {
    decide(pet, world.people)
  }

  giveWay(pet, world)
  pet.legs = pet.legs.filter((leg, i) => i === pet.legs.length - 1 || leg.t1 >= now - LEG_KEEP_MS)

  return legAt(pet, now).kind !== 'idle'
}

// A pet keeping still lies at home; its routine starts afresh from there.
function sendHome(pet: PetState, nowMs: number): void {
  const home = HOMES[pet.kind]

  pet.legs = []
  pet.end = nowMs
  pet.node = home
  pet.near = home
  pet.spot = NODES[home]
  pet.perch = undefined
}

function isStill(pet: PetState, world: PetWorld): boolean {
  return world.isReduced || (pet.kind === 'corgi' && world.isQuiet)
}

function decide(pet: PetState, people: readonly Point[]): void {
  const pool = poolOf(pet.kind)
  const rng = createRng(seedOf(PET_POOL, pet.kind, String(pet.draws)))

  pet.draws = (pet.draws + 1) % MAX_DRAWS

  if (!isAmbientBout(pool, pet.end)) {
    const pose = pet.legs.at(-1)?.pose ?? REST_POSES[pet.kind]

    pushIdle(pet, { ms: nextAmbientAt(pool, pet.end) - pet.end, pose, perch: pet.perch })
    return
  }

  if (pet.perch !== undefined) {
    jumpDown(pet, rng.pick(pet.perch.from))
    return
  }

  const r = rng.next()
  const isPerching = r < PERCH_CHANCE[pet.kind] && tryPerch(pet, { people, rng })
  const isWandering =
    !isPerching && r < PERCH_CHANCE[pet.kind] + WANDER_CHANCE && tryWander(pet, { people, rng })

  if (!(isPerching || isWandering)) {
    pushIdle(pet, { ms: between(rng.next(), IDLE_STAY_MS), pose: restPose(pet, rng.next()) })
  }
}

interface Choice {
  readonly people: readonly Point[]
  readonly rng: ReturnType<typeof createRng>
}

function tryPerch(pet: PetState, choice: Choice): boolean {
  const free = PERCHES.filter(
    (each) => each.who.includes(pet.kind) && !isPersonNear(choice.people, each.spot, each.clearPx)
  )
  const [first, ...rest] = free

  if (first === undefined) {
    return false
  }

  const perch = choice.rng.pick([first, ...rest])

  if (!walkTo(pet, { to: choice.rng.pick(perch.from), people: choice.people })) {
    return false
  }

  pushJump(pet, perch.spot)
  pet.perch = perch
  pet.node = undefined
  pushIdle(pet, {
    ms: between(choice.rng.next(), PERCH_STAY_MS),
    pose: restPose(pet, choice.rng.next()),
    perch,
  })

  return true
}

function tryWander(pet: PetState, choice: Choice): boolean {
  const [first, ...rest] = NODE_IDS.filter((id) => id !== pet.node)

  const to = first === undefined ? undefined : choice.rng.pick([first, ...rest])

  if (to === undefined || !walkTo(pet, { to, people: choice.people })) {
    return false
  }

  pushIdle(pet, {
    ms: between(choice.rng.next(), WANDER_STAY_MS),
    pose: restPose(pet, choice.rng.next()),
  })

  return true
}

function jumpDown(pet: PetState, to: NodeId): void {
  pushJump(pet, NODES[to])
  pet.node = to
  pet.near = to
  pet.perch = undefined
}

// A walk along the graph, refused when someone stands on the way.
function walkTo(
  pet: PetState,
  walk: { readonly to: NodeId; readonly people: readonly Point[] }
): boolean {
  const route = routeOf(pet.node ?? pet.near, walk.to)

  if (route === undefined) {
    return false
  }

  const points: Spot[] = [
    ...(pet.node === undefined ? [pet.spot] : []),
    ...route.map((id) => NODES[id]),
  ]
  const isBlocked = points.some((point, i) => {
    const before = points[i - 1]

    return before !== undefined && isPersonOnLine(walk.people, before, point)
  })

  if (isBlocked) {
    return false
  }

  for (const point of points.slice(1)) {
    const from = pet.spot
    const ms = (Math.hypot(point.x - from.x, point.y - from.y) / PX_PER_S[pet.kind]) * MS_PER_SECOND

    push(pet, { kind: 'walk', ms, to: point, pose: 'walk' })
  }

  pet.node = walk.to
  pet.near = walk.to

  return true
}

// Someone comes near: a walking pet stops and sits where it is; a perched one leaves its perch.
function giveWay(pet: PetState, world: PetWorld): void {
  const leg = legAt(pet, world.nowMs)
  const at = toPetView(pet, world).at

  if (leg.kind === 'walk' && isPersonNear(world.people, at, PERSON_CLEAR_PX)) {
    pet.legs = []
    pet.end = world.nowMs
    pet.node = undefined
    pet.spot = { x: at.x, y: at.y, lift: 0 }
    pushIdle(pet, { ms: STARTLED_MS, pose: pet.kind === 'cat' ? 'sit' : 'stand' })
    return
  }

  const perch = leg.kind === 'idle' ? leg.perch : undefined

  if (perch !== undefined && isPersonNear(world.people, perch.spot, perch.clearPx)) {
    leg.t1 = world.nowMs
    pet.end = world.nowMs
  }
}

function pushIdle(
  pet: PetState,
  idle: { readonly ms: number; readonly pose: PetPose; readonly perch?: Perch | undefined }
): void {
  push(pet, {
    kind: 'idle',
    ms: idle.ms,
    to: pet.spot,
    pose: idle.pose,
    ...(idle.perch === undefined ? {} : { perch: idle.perch }),
  })
}

function pushJump(pet: PetState, to: Spot): void {
  push(pet, { kind: 'jump', ms: JUMP_MS[pet.kind], to, pose: 'walk' })
}

function push(
  pet: PetState,
  leg: Pick<Leg, 'kind' | 'to' | 'pose' | 'perch'> & { readonly ms: number }
): void {
  const dx = leg.to.x - pet.spot.x

  if (dx !== 0) {
    pet.isFlipped = dx < 0
  }

  const next: Leg = {
    kind: leg.kind,
    t0: pet.end,
    t1: pet.end + Math.max(0, leg.ms),
    from: pet.spot,
    to: leg.to,
    pose: leg.pose,
    isFlipped: pet.isFlipped,
    ...(leg.perch === undefined ? {} : { perch: leg.perch }),
  }

  pet.legs = [...pet.legs, next].slice(-MAX_LEGS)
  pet.end = next.t1
  pet.spot = leg.to
}

function toPetView(pet: PetState, world: PetWorld): PetView {
  if (isStill(pet, world)) {
    const home = NODES[HOMES[pet.kind]]
    const pose = pet.kind === 'corgi' ? 'sleep' : restOrAwake(pet, REST_POSES.cat, world)

    return { kind: pet.kind, prev: home, at: home, lift: 0, pose, isFlipped: false }
  }

  const leg = legAt(pet, world.nowMs)
  const u =
    leg.t1 > leg.t0 ? Math.min(1, Math.max(0, (world.nowMs - leg.t0) / (leg.t1 - leg.t0))) : 1
  const arc = leg.kind === 'jump' ? 4 * u * (1 - u) * JUMP_ARC_PX : 0
  const at = { x: lerp(leg.from.x, leg.to.x, u), y: lerp(leg.from.y, leg.to.y, u) }
  const pose = leg.kind === 'idle' ? restOrAwake(pet, leg.pose, world) : leg.pose

  return {
    kind: pet.kind,
    prev: pet.prev,
    at,
    lift: lerp(leg.from.lift, leg.to.lift, u) + arc,
    pose,
    isFlipped: leg.isFlipped,
  }
}

// A woken cat sits up wherever it rests.
function restOrAwake(pet: PetState, pose: PetPose, world: PetWorld): PetPose {
  return pet.kind === 'cat' && world.isCatAwake ? 'sit' : pose
}

function legAt(pet: PetState, nowMs: number): Leg {
  const now = pet.legs.find((leg) => nowMs >= leg.t0 && nowMs < leg.t1)
  const last = pet.legs.at(-1)

  return (
    now ??
    last ?? {
      kind: 'idle',
      t0: nowMs,
      t1: nowMs,
      from: pet.spot,
      to: pet.spot,
      pose: REST_POSES[pet.kind],
      isFlipped: pet.isFlipped,
    }
  )
}

function stepFish(fish: FishState, world: PetWorld): void {
  if (world.isReduced || !isAmbientBout(fish.pool, world.nowMs)) {
    return
  }

  fish.u = (fish.u + world.dtMs * FISH_SWEEP_PER_MS) % 2
  fish.bob = (fish.bob + world.dtMs) % (FISH_BOB_MS * 2)
}

function toFishView(fish: FishState): FishView {
  const isBack = fish.u >= 1
  const bob = Math.sin((fish.bob / FISH_BOB_MS) * Math.PI) * FISH_BOB_DEPTH

  return { k: isBack ? 2 - fish.u : fish.u, depth: fish.depth + bob, isFlipped: isBack }
}

function restPose(pet: PetState, draw: number): PetPose {
  if (pet.kind === 'corgi') {
    return draw < (pet.perch === undefined ? 0.6 : 1) ? 'lie' : 'stand'
  }

  const isAtBed = pet.perch === undefined && pet.node === HOMES.cat

  return draw < (isAtBed ? 0.25 : 0.6) ? 'sit' : 'sleep'
}

function poolOf(kind: PetKind): string {
  return `${PET_POOL}:${kind}`
}

function between(draw: number, range: { readonly min: number; readonly max: number }): number {
  return range.min + draw * (range.max - range.min)
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u
}
