import type { WalkerState } from '@/web/scene/sim/actors/walk'
import type { ActorState } from '@/web/scene/sim/director'
import type { Goal } from '@/web/scene/sim/vocabulary'
import type { ActorId, FloorId } from '@/web/scene/types'
import { isWalking } from '@/web/scene/sim/actors/walk'
import { seatPoseOf } from '@/web/scene/sim/life/state'
import {
  CROSSING_X,
  type Errand,
  goOut,
  isOutside,
  turnBack,
} from '@/web/scene/sim/street/errand-walk'
import { createPed, type Ped, type WalkTick } from '@/web/scene/sim/street/ped-walk'
import {
  ERRAND_SHOPS,
  type ErrandItem,
  type ErrandShop,
  type ErrandView,
  type ShopKind,
} from '@/web/scene/street-types'
import { STREET_DOOR } from '@/web/scene/world/doors'
import { isShopOpen, type RegionPack, shopDoorOf } from '@/web/scene/world/regions'
import { createRng, seedOf } from '@/web/scene/world/rng'

const ERRAND_MAX_OUT = 1
// Page time: how often someone may be sent, after how long free, and the gap between two trips;
// after the close, when the day's work is done, people are free sooner and go out more often.
const ERRAND_CHECK_MS = 60_000
const ERRAND_IDLE_MS = 300_000
const ERRAND_GAP_MS = Object.freeze({ min: 1_200_000, max: 1_800_000 })
const ERRAND_AFTER_CLOSE_IDLE_MS = 120_000
const ERRAND_AFTER_CLOSE_GAP_MS = Object.freeze({ min: 360_000, max: 600_000 })
// Sim time: the walk inside at this many times the person's pace; door to door and the office
// leg at most this long.
const ERRAND_INDOOR_SPEED = 2.2
const ERRAND_TRIP_MS = 150_000
const ERRAND_OFFICE_LEG_MS = 20_000
// A nearer shop is likelier: its weight halves this far from the crossing.
const SHOP_WEIGHT_PX = 150
const ERRAND_FLOOR: FloorId = 'office'

type Rng = ReturnType<typeof createRng>

/** What the errands drive in the director: a person's life goal, their walker and seat. */
interface ErrandHost {
  setLife(id: ActorId, goal: Goal | undefined): void
  walkerOf(id: ActorId): WalkerState | undefined
  placeAtSeat(id: ActorId): void
}

/** Who is out on an errand and what they brought home: the slots, the people back at their seat
 *  with the item they carried (`home`, emptied by the office life), when each person became free,
 *  the page-time clock of the next check, and when the last trip left with the share of the gap
 *  it rolled (a trip is due once the gap in force has passed since then). */
export interface Errands {
  readonly host: ErrandHost
  readonly slots: readonly Errand[]
  readonly home: { readonly actor: ActorId; readonly item: ErrandItem | undefined }[]
  readonly freeSince: Map<ActorId, number>
  readonly tick: WalkTick
  nextCheckAt: number
  lastTripAt: number
  gapRoll: number
  rng: Rng
}

/** What an office step reads: the people, who of them is free for the office life and who is in a
 *  moment of it, the clocks, the pack and whether anyone may leave now. */
interface OfficeStep {
  readonly actors: ReadonlyMap<ActorId, ActorState>
  readonly isFree: (actor: ActorState) => boolean
  readonly isBusyWithLife: (id: ActorId) => boolean
  readonly nowMs: number
  readonly pageMs: number
  readonly minute: number
  readonly day: string
  readonly pack: RegionPack
  readonly canLeave: boolean
  readonly isRelaxed: boolean
  readonly isReduced: boolean
}

export function createErrands(host: ErrandHost): Errands {
  return {
    host,
    slots: Array.from({ length: ERRAND_MAX_OUT }, createErrand),
    home: [],
    freeSince: new Map(),
    tick: { dt: 0, nowMs: 0, canCross: false },
    nextCheckAt: 0,
    lastTripAt: Number.NEGATIVE_INFINITY,
    gapRoll: 0,
    rng: createRng(0),
  }
}

export function isOnErrand(errands: Errands, id: ActorId): boolean {
  return errands.slots.some((errand) => errand.on && errand.actor === id)
}

/** Past the street door: off the floor, drawn by the street. */
export function isOut(errands: Errands, id: ActorId): boolean {
  return errands.slots.some((errand) => errand.on && errand.actor === id && isOutside(errand))
}

/** The person's errand as the scene shows it, and where the street has them while out. */
export function errandOf(
  errands: Errands,
  id: ActorId
): { readonly view: ErrandView; readonly ped: Ped } | undefined {
  const errand = errands.slots.find((held) => held.on && held.actor === id)

  if (errand === undefined) {
    return undefined
  }

  const isBack = errand.phase === 'back' || errand.phase === 'entering'
  const item = !isBack || errand.hasItem ? errand.item : undefined
  const view: ErrandView = {
    stage: isBack ? 'back' : stageOf(errand.phase),
    shop: errand.kind,
    isOut: isOutside(errand),
    ...(item === undefined ? {} : { item }),
  }

  return { view, ped: errand.ped }
}

/** Ends every errand: each person at their seat with what they bought, every slot free. */
export function endErrands(errands: Errands): void {
  for (const errand of errands.slots) {
    if (errand.on) {
      const wasOut = isOutside(errand)

      finish(errands, errand)

      if (wasOut) {
        errands.host.placeAtSeat(errand.actor)
      }
    }
  }
}

/** The office side, once a sim step: a person called back turns round, the walk to and from the
 *  street door, the trip's time limits, and now and then one free person sent to an open shop. */
export function stepErrandsOffice(errands: Errands, at: OfficeStep): void {
  if (at.isReduced) {
    endErrands(errands)
    return
  }

  for (const errand of errands.slots) {
    const actor = errand.on ? at.actors.get(errand.actor) : undefined

    if (errand.on && actor === undefined) {
      finish(errands, errand)
    } else if (actor !== undefined) {
      stepOffice(errands, { errand, actor, nowMs: at.nowMs })
    }
  }

  noteFree(errands, at)
  maybeSend(errands, at)
}

function stepOffice(
  errands: Errands,
  at: { readonly errand: Errand; readonly actor: ActorState; readonly nowMs: number }
): void {
  const { errand, actor, nowMs } = at
  const isCalled = isCalledBack(errand, actor)
  const isLegOver = nowMs - errand.since > ERRAND_OFFICE_LEG_MS
  const isArrived = actor.goal === errand.goal && isThere(actor)

  if (errand.phase === 'leaving') {
    stepLeaving(errands, { errand, isEnded: isCalled || isLegOver, isAtDoor: isArrived, nowMs })
  } else if (errand.phase === 'entering') {
    if (isCalled || isLegOver || isArrived) {
      finish(errands, errand)
    }
  } else if (nowMs - errand.outAt > ERRAND_TRIP_MS) {
    finish(errands, errand)
    errands.host.placeAtSeat(errand.actor)
  } else if (isCalled && errand.phase !== 'back') {
    turnBack(errand)
  }
}

// Called back: a goal the live store gives them, or a real event's gesture. Past the
// door the walk home's goal reaches the director a step later than the street sets it.
function isCalledBack(errand: Errand, actor: ActorState): boolean {
  const isPending = errand.phase === 'entering' && actor.goal === errand.doorGoal

  return (
    (actor.goal !== errand.goal && !isPending) || actor.beats.some((beat) => beat.kind !== 'life')
  )
}

// On the walk to the street door: back to the seat when called or too long, out once there.
function stepLeaving(
  errands: Errands,
  at: {
    readonly errand: Errand
    readonly isEnded: boolean
    readonly isAtDoor: boolean
    readonly nowMs: number
  }
): void {
  if (at.isEnded) {
    finish(errands, at.errand)
  } else if (at.isAtDoor) {
    goOut(at.errand, at.nowMs)
  }
}

function isThere(actor: ActorState): boolean {
  return actor.isSettled && !isWalking(actor.walker)
}

// Who has been free since when, by page time; anyone not free starts over.
function noteFree(errands: Errands, at: OfficeStep): void {
  for (const [id, actor] of at.actors) {
    if (!at.isFree(actor) || isOnErrand(errands, id)) {
      errands.freeSince.delete(id)
    } else if (!errands.freeSince.has(id)) {
      errands.freeSince.set(id, at.pageMs)
    }
  }
}

// Once a page minute: when nobody else is out and the gap since the last trip has passed, one
// person free long enough, at their seat, goes to an open shop.
function maybeSend(errands: Errands, at: OfficeStep): void {
  if (at.pageMs < errands.nextCheckAt) {
    return
  }

  errands.nextCheckAt = at.pageMs + ERRAND_CHECK_MS
  errands.rng = createRng(seedOf(at.day, 'errand', String(Math.floor(at.pageMs / ERRAND_CHECK_MS))))

  const slot = errands.slots.find((errand) => !errand.on)
  const { idleMs, gap } = paceOf(at)

  if (
    !at.canLeave ||
    slot === undefined ||
    at.pageMs < errands.lastTripAt + gap.min + errands.gapRoll * (gap.max - gap.min)
  ) {
    return
  }

  const ready = [...at.actors.values()].filter(
    (candidate) =>
      candidate.def.floor === ERRAND_FLOOR &&
      candidate.floor === ERRAND_FLOOR &&
      !at.isBusyWithLife(candidate.def.id) &&
      isThere(candidate) &&
      at.pageMs - (errands.freeSince.get(candidate.def.id) ?? at.pageMs) >= idleMs
  )
  const actor = ready[errands.rng.int(0, ready.length - 1)]
  const shop = actor === undefined ? undefined : pickShop(errands.rng, at)

  if (actor !== undefined && shop !== undefined) {
    send(errands, { errand: slot, actor, shop, at })
  }
}

// The pace in force: how long free, and the gap between trips.
function paceOf(at: OfficeStep): {
  readonly idleMs: number
  readonly gap: { readonly min: number; readonly max: number }
} {
  return at.isRelaxed
    ? { idleMs: ERRAND_AFTER_CLOSE_IDLE_MS, gap: ERRAND_AFTER_CLOSE_GAP_MS }
    : { idleMs: ERRAND_IDLE_MS, gap: ERRAND_GAP_MS }
}

// An open shop that hands something over, nearer ones likelier.
function pickShop(rng: Rng, at: OfficeStep): number | undefined {
  const { shops } = at.pack
  const open = shops.flatMap((row, index) =>
    row.item !== undefined && isErrandShop(row.kind) && isShopOpen(row, at.minute) ? [index] : []
  )
  const weights = open.map(
    (index) => 1 / (1 + Math.abs(shopDoorOf(shops, index).x - CROSSING_X) / SHOP_WEIGHT_PX)
  )
  let roll = rng.next() * weights.reduce((sum, weight) => sum + weight, 0)

  for (const [order, index] of open.entries()) {
    roll -= weights[order] ?? 0

    if (roll <= 0) {
      return index
    }
  }

  return open.at(-1)
}

function send(
  errands: Errands,
  job: {
    readonly errand: Errand
    readonly actor: ActorState
    readonly shop: number
    readonly at: OfficeStep
  }
): void {
  const { errand, actor, at } = job
  const row = at.pack.shops[job.shop]
  const walker = errands.host.walkerOf(actor.def.id)

  if (row?.item === undefined || !isErrandShop(row.kind) || walker === undefined) {
    return
  }

  errand.on = true
  errand.actor = actor.def.id
  errand.shop = job.shop
  errand.kind = row.kind
  errand.item = row.item
  errand.phase = 'leaving'
  errand.hasItem = false
  errand.since = at.nowMs
  errand.speed = walker.speed
  errand.seatPose = seatPoseOf(actor)
  errand.doorGoal = { kind: 'life', target: STREET_DOOR, pose: 'idle', since: at.nowMs }
  errand.goal = errand.doorGoal
  errand.ped.staff = { id: actor.def.id, role: actor.def.role }
  errand.ped.on = false
  walker.speed *= ERRAND_INDOOR_SPEED
  errands.lastTripAt = at.pageMs
  errands.gapRoll = errands.rng.next()
  errands.host.setLife(actor.def.id, errand.goal)
}

// The slot is free again: the person's pace and their seat back, and what they carried home for
// the office life to put on their desk.
function finish(errands: Errands, errand: Errand): void {
  const walker = errands.host.walkerOf(errand.actor)

  if (walker !== undefined) {
    walker.speed = errand.speed
  }

  errands.home.push({ actor: errand.actor, item: errand.hasItem ? errand.item : undefined })
  errand.on = false
  errand.ped.on = false
  errand.doorGoal = undefined
  errand.goal = undefined
  errands.host.setLife(errand.actor, undefined)
}

function isErrandShop(kind: ShopKind): kind is ErrandShop {
  return (ERRAND_SHOPS as readonly ShopKind[]).includes(kind)
}

function stageOf(phase: Errand['phase']): ErrandView['stage'] {
  return phase === 'queue' || phase === 'buying' ? phase : 'going'
}

function createErrand(): Errand {
  return {
    on: false,
    actor: 'clerk',
    shop: 0,
    kind: 'cafe',
    item: 'cup',
    phase: 'leaving',
    hasItem: false,
    seatPose: 'idle',
    doorGoal: undefined,
    goal: undefined,
    since: 0,
    outAt: 0,
    buyUntil: 0,
    speed: 0,
    ped: createPed(),
  }
}
