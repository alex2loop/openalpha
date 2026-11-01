import type { CritterPose, CritterView, PersonView, VehicleView } from '@/web/scene/street-types'
import {
  PIGEON_HOMES,
  perchesOf,
  SPARROWS,
  stepPigeon,
  stepSparrow,
} from '@/web/scene/sim/street/critter-birds'
import {
  beatOf,
  createCritter,
  flip,
  rest,
  WALK_FRAMES,
  walkTo,
} from '@/web/scene/sim/street/critter-moves'
import { CAT_WALL } from '@/web/scene/sim/street/park-layout'
import {
  addPoint,
  clearRoute,
  createPed,
  PAVEMENT,
  type Ped,
  syncGait,
  takePed,
  WALK_REACH_PX,
  type WalkTick,
  walkPed,
} from '@/web/scene/sim/street/ped-walk'
import { insertByY } from '@/web/scene/sim/street/traffic'
import { type Rect, WORLD } from '@/web/scene/types'
import { isWithin, type RegionPack } from '@/web/scene/world/regions'
import { createRng, seedOf } from '@/web/scene/world/rng'
import { isInside } from '@/web/scene/world/rooms'

const CAT = Object.freeze({
  pxPerS: 3.4,
  reach: 13,
  pxPerFrame: 0.8,
  nearPx: 5,
  groom: 0.3,
  walk: 0.9,
  turn: 0.3,
  groomMs: { min: 3_200, span: 2_600 },
  sitMs: { min: 1_500, span: 2_000 },
  arriveMs: { min: 800, span: 1_500 },
})
const GROOM = Object.freeze({ frameMs: 400, frames: 2 })
// The dog trots this far ahead of its walker on the far pavement; the walker stops now and then
// for it to sniff. Placed by the clock, a walk is out at this share of its hours.
const DOG = Object.freeze({
  lead: 5.2,
  dy: 0.6,
  chance: 0.002,
  pxPerS: 3.2,
  stopGapMs: { min: 20_000, span: 20_000 },
  stopMs: { min: 2_000, span: 2_000 },
  pxPerFrame: 0.9,
  hand: { dx: 1, dy: -2.6 },
  placedShare: 0.5,
})
// Sparrows of one tree perch a little apart; placed by the clock, this share are on the pavement
// for this long yet, and everyone rests a moment before their next act.
const PERCH_SPREAD = 1.4
const GROUND_SHARE = 0.5
const SETTLE = Object.freeze({ restMs: { min: 300, span: 1_500 }, groundMs: 9_000 })

type Rng = ReturnType<typeof createRng>

type CritterState = 'rest' | 'walk' | 'fly' | 'away' | 'land' | 'perch' | 'drop' | 'hop' | 'rise'

/** One animal, written only by the street sim: its home (a sparrow's perch), its flock, what it
 *  is doing since `t0` (its act until `nextAt`, its stay until `until`), where a move started and
 *  heads, and whether it showed and changed this step. */
export interface Critter extends CritterView {
  readonly prev: { x: number; y: number }
  readonly at: { x: number; y: number }
  pose: CritterPose
  frame: number
  facing: -1 | 1
  lift: number
  lead: CritterView['lead']
  readonly home: { x: number; y: number }
  readonly flock: number
  state: CritterState
  t0: number
  nextAt: number
  until: number
  from: number
  tx: number
  dist: number
  isShown: boolean
  hasChanged: boolean
}

/** The street's animals, the dog and its walker (a pool of one), the walker's hand the lead runs
 *  to, and the animals showing, north to south. */
export interface Critters {
  readonly all: readonly Critter[]
  readonly dog: Critter
  readonly shown: Critter[]
  readonly walkers: Ped[]
  readonly tick: WalkTick
  readonly hand: { x: number; y: number }
  nextStopAt: number
  rng: Rng
}

/** What an animals step reads: the pack, the page minute, sim time, the seconds stepped, and the
 *  people and vehicles that scare the birds. */
export interface CritterStep {
  readonly pack: RegionPack
  readonly minute: number
  readonly nowMs: number
  readonly dt: number
  readonly people: readonly PersonView[]
  readonly vehicles: readonly VehicleView[]
}

export function createCritters(): Critters {
  const dog = createCritter('dog', { x: 0, y: PAVEMENT.far, flock: 0 })

  return {
    all: [
      ...PIGEON_HOMES.map((home) => createCritter('pigeon', home)),
      ...Array.from({ length: SPARROWS.count }, (_, flock) =>
        createCritter('sparrow', { x: 0, y: SPARROWS.groundY, flock })
      ),
      createCritter('cat', { x: CAT_WALL.x, y: CAT_WALL.top, flock: 0 }),
      dog,
    ],
    dog,
    shown: [],
    walkers: [createPed()],
    tick: { dt: 0, nowMs: 0, canCross: false },
    hand: { x: 0, y: 0 },
    nextStopAt: 0,
    rng: createRng(0),
  }
}

/** Rebuilds the animals from the clock: pigeons at home, sparrows in their trees or under them,
 *  the cat on its wall at night, a dog out at its hours, as a still if nothing steps. */
export function resetCritters(
  critters: Critters,
  at: {
    readonly pack: RegionPack
    readonly day: string
    readonly minute: number
    readonly nowMs: number
  }
): void {
  const perches = perchesOf(at.pack)

  critters.rng = createRng(seedOf(at.day, at.pack.id, 'critters', String(Math.floor(at.minute))))

  for (const walker of critters.walkers) {
    walker.on = false
  }

  if (isWithin(at.pack.hours.parks.joggers, at.minute) && critters.rng.next() < DOG.placedShare) {
    startWalk(critters, { nowMs: at.nowMs, isPlaced: true })
  }

  for (const critter of critters.all) {
    if (critter.kind === 'sparrow') {
      critter.home.x = (perches[critter.flock] ?? 0) + (critter.flock - 1) * PERCH_SPREAD
    }

    settle(critters, { critter, nowMs: at.nowMs })
    critter.isShown = isAbout(critters, { critter, pack: at.pack, minute: at.minute })
    critter.hasChanged = false
  }

  followWalker(critters)
  syncShown(critters)
}

/** One sim step: birds walk, peck, hop and take off when someone comes close, the cat keeps its
 *  wall at night, the dog walks its walker. */
export function stepCritters(critters: Critters, at: CritterStep): void {
  stepWalk(critters, at)

  for (const critter of critters.all) {
    const { x, y } = critter.at
    const { frame, lift, isShown } = critter

    critter.prev.x = x
    critter.prev.y = y
    critter.isShown = isAbout(critters, { critter, pack: at.pack, minute: at.minute })

    if (critter.isShown) {
      stepCritter(critters, critter, at)
    }

    critter.hasChanged =
      isShown !== critter.isShown ||
      critter.at.x !== x ||
      critter.at.y !== y ||
      critter.frame !== frame ||
      critter.lift !== lift
  }

  syncShown(critters)
}

/** An animal in `rect` moved, changed its frame, or came or went this step. */
export function isCritterMovingIn(critters: Critters, rect: Rect): boolean {
  for (const critter of critters.all) {
    if (critter.hasChanged && isInside(rect, critter.at)) {
      return true
    }
  }

  return false
}

// Out by the clock: the birds by day (a pigeon away out of sight hides itself), the cat at night,
// the dog while its walk lasts.
function isAbout(
  critters: Critters,
  at: { readonly critter: Critter; readonly pack: RegionPack; readonly minute: number }
): boolean {
  const isNight = isWithin(at.pack.hours.night, at.minute)

  switch (at.critter.kind) {
    case 'pigeon':
    case 'sparrow':
      return !isNight
    case 'cat':
      return isNight
    case 'dog':
      return critters.walkers[0]?.on === true
    default:
      return at.critter.kind satisfies never
  }
}

// Back home at rest: a pigeon on its kerb, a sparrow in its tree or under it, the cat sitting.
function settle(
  critters: Critters,
  at: { readonly critter: Critter; readonly nowMs: number }
): void {
  const { critter } = at
  const isSparrow = critter.kind === 'sparrow'
  const isPerched = isSparrow && critters.rng.next() >= GROUND_SHARE

  rest(critter, {
    pose: critter.kind === 'cat' ? 'sit' : 'stand',
    nowMs: at.nowMs,
    rng: critters.rng,
    ms: SETTLE.restMs,
  })
  critter.at.x = critter.home.x
  critter.at.y = isSparrow ? SPARROWS.groundY : critter.home.y
  critter.prev.x = critter.at.x
  critter.prev.y = critter.at.y
  critter.until = at.nowMs + SETTLE.groundMs

  if (isPerched) {
    critter.state = 'perch'
    critter.lift = SPARROWS.perchLift
  }
}

function stepCritter(critters: Critters, critter: Critter, step: CritterStep): void {
  switch (critter.kind) {
    case 'pigeon':
      stepPigeon(critters, critter, step)
      return
    case 'sparrow':
      stepSparrow(critters, critter, step)
      return
    case 'cat':
      stepCat(critters, critter, step)
      return
    case 'dog':
      followWalker(critters)
      return
    default:
      critter.kind satisfies never
  }
}

// Sits, washes a paw, or walks a little way along the wall top.
function stepCat(critters: Critters, cat: Critter, step: CritterStep): void {
  const { rng } = critters
  const { nowMs } = step

  if (cat.state === 'walk') {
    walkTo(cat, { pxPerS: CAT.pxPerS, dt: step.dt, pxPerFrame: CAT.pxPerFrame })

    if (cat.at.x === cat.tx) {
      rest(cat, { pose: 'sit', nowMs, rng, ms: CAT.arriveMs })
    }

    return
  }

  cat.frame = cat.pose === 'groom' ? beatOf(nowMs, GROOM) : 0

  if (nowMs < cat.nextAt) {
    return
  }

  const roll = rng.next()

  if (roll < CAT.groom) {
    rest(cat, { pose: 'groom', nowMs, rng, ms: CAT.groomMs })
  } else if (roll < CAT.walk) {
    const tx = CAT_WALL.x - CAT.reach + rng.next() * 2 * CAT.reach

    cat.state = 'walk'
    cat.pose = 'walk'
    cat.tx = Math.abs(tx - cat.at.x) < CAT.nearPx ? cat.at.x - cat.facing * CAT.reach : tx
    cat.tx = Math.max(CAT_WALL.x - CAT.reach, Math.min(CAT_WALL.x + CAT.reach, cat.tx))
  } else {
    rest(cat, { pose: 'sit', nowMs, rng, ms: CAT.sitMs })
    cat.facing = rng.next() < CAT.turn ? flip(cat.facing) : cat.facing
  }
}

// A walk sets off from one end of the far pavement now and then at its hours, stops now and then
// for the dog, and ends at the other end.
function stepWalk(critters: Critters, step: CritterStep): void {
  const walker = critters.walkers[0]
  const { nowMs } = step

  if (walker === undefined) {
    return
  }

  if (!walker.on) {
    if (isWithin(step.pack.hours.parks.joggers, step.minute) && critters.rng.next() < DOG.chance) {
      startWalk(critters, { nowMs, isPlaced: false })
    }

    return
  }

  critters.tick.dt = step.dt
  critters.tick.nowMs = nowMs

  if (nowMs >= critters.nextStopAt) {
    walker.holdUntil = nowMs + DOG.stopMs.min + critters.rng.next() * DOG.stopMs.span
    critters.nextStopAt =
      walker.holdUntil + DOG.stopGapMs.min + critters.rng.next() * DOG.stopGapMs.span
  }

  if (nowMs < walker.holdUntil) {
    walker.prev.x = walker.at.x
    walker.prev.y = walker.at.y
  } else if (walkPed(walker, critters.tick)) {
    walker.on = false
  }

  syncGait(walker, nowMs)
}

function startWalk(
  critters: Critters,
  at: { readonly nowMs: number; readonly isPlaced: boolean }
): void {
  const { rng } = critters
  const isEast = rng.next() < 0.5
  const [from, to] = isEast
    ? [-WALK_REACH_PX, WORLD.w + WALK_REACH_PX]
    : [WORLD.w + WALK_REACH_PX, -WALK_REACH_PX]
  const walker = takePed({ pool: critters.walkers, rng }, { x: from, y: PAVEMENT.far })

  if (walker === undefined) {
    return
  }

  walker.speed = DOG.pxPerS
  walker.facing = isEast ? 'east' : 'west'
  walker.movedAt = at.nowMs
  clearRoute(walker)
  addPoint(walker, from, PAVEMENT.far)
  addPoint(walker, to, PAVEMENT.far)
  walker.leg = 1

  if (at.isPlaced) {
    walker.at.x = from + (to - from) * rng.next()
    walker.prev.x = walker.at.x
  }

  critters.nextStopAt = at.nowMs + DOG.stopGapMs.min + rng.next() * DOG.stopGapMs.span
}

// Trotting ahead of the walker on its lead, nose down while the walker waits.
function followWalker(critters: Critters): void {
  const { dog, hand } = critters
  const walker = critters.walkers[0]

  if (walker === undefined || !walker.on) {
    dog.lead = undefined
    return
  }

  const dir = walker.facing === 'west' ? -1 : 1
  const isStopped = walker.prev.x === walker.at.x

  dog.facing = dir
  dog.at.x = walker.at.x + dir * DOG.lead
  dog.at.y = walker.at.y + DOG.dy
  dog.pose = isStopped ? 'sniff' : 'walk'
  dog.frame = isStopped ? 0 : Math.floor(walker.dist / DOG.pxPerFrame) % WALK_FRAMES
  hand.x = walker.at.x + dir * DOG.hand.dx
  hand.y = walker.at.y + DOG.hand.dy
  dog.lead = hand
}

// The animals showing, north to south, the order they are drawn in.
function syncShown(critters: Critters): void {
  critters.shown.length = 0

  for (const critter of critters.all) {
    if (critter.isShown) {
      insertByY(critters.shown, critter)
    }
  }
}
