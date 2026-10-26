import type { ActorState } from '@/web/scene/sim/director'
import type { ActorId, FloorId, LifeLine, Point } from '@/web/scene/types'
import { distance } from '@/web/scene/sim/actors/nav'
import { beginMoment, type MomentKind, type StopSpec, toStop } from '@/web/scene/sim/life/moments'
import {
  drawBetween,
  isDoneToday,
  isPicked,
  type LifeState,
  type LifeStep,
  markDone,
  momentsOn,
  seatedFree,
} from '@/web/scene/sim/life/state'
import { approachOf } from '@/web/scene/sim/places'
import { type PropKind, propsOn } from '@/web/scene/world/props'
import { isInRange } from '@/web/scene/world/regions'
import { createRng, seedOf } from '@/web/scene/world/rng'
import { PANTRY, SOFA_SEATS } from '@/web/scene/world/seats'

const IDLE_CHECK_MS = 20_000
const IDLE_WALK_GAP_MS = Object.freeze({ min: 300_000, max: 600_000 })
const IDLE_STAY_MS = 8_000
const IDLE_PLACES: ReadonlySet<PropKind> = new Set(['cooler', 'sofa', 'window', 'plant'])
// An idle walk never ends this close to someone at work.
const IDLE_WORK_CLEAR_PX = 40
const COFFEE_MAX = 2
const COFFEE_PICK_PERCENT = 55
const COFFEE_HOLD_MS = Object.freeze({ min: 3_200, max: 5_200 })
const COFFEE_GAP_MS = Object.freeze({ min: 12_000, max: 30_000 })
const DESSERT_MAX = 3
const DESSERT_HOLD_MS = Object.freeze({ min: 4_500, max: 7_500 })
const DESSERT_GAP_MS = Object.freeze({ min: 6_000, max: 14_000 })
// The last minute of the cart's stay sends no one: they would find it rolling away.
const DESSERT_LAST_FETCH_MIN = 1
const YAWN_MS = 3_600
const YAWN_MAX = 2
const YAWN_PICK_PERCENT = 50
const YAWN_GAP_MS = Object.freeze({ min: 8_000, max: 40_000 })
const CHAT_GAP_MS = 240_000
const CHAT_HOLD_MS = 9_400
const COFFEE_LINE = 'coffee'
const COFFEE_TAG = 'coffee'
const COFFEE_CLOSE_TAG = 'coffee-close'
const DESSERT_LINE = 'friday'
const CHAT_LINE = 'chat'

/** Every check, at most one free person a floor walks to a non-work place, once their own gap
 *  since the last one has passed. */
export function stepIdle(state: LifeState, step: LifeStep): void {
  if (step.nowMs < state.idleCheckAt || !step.isCalm) {
    return
  }

  state.idleCheckAt = step.nowMs + IDLE_CHECK_MS

  const slot = String(Math.floor(step.nowMs / IDLE_CHECK_MS))

  for (const floor of floorsOf(step)) {
    const due = seatedFree(step, floor).filter(
      (actor) => step.nowMs >= idleDueOf(state, actor, step)
    )
    const [first, ...rest] = due
    const place = placeFor(step, floor, slot)

    if (first === undefined || place === undefined || momentsOn(state, { step, floor }) > 0) {
      continue
    }

    const chosen = createRng(seedOf('idle', floor, slot)).pick([first, ...rest])

    begin(state, { actor: chosen, kind: 'idle', nowMs: step.nowMs }, [
      { at: place, pose: 'idle', holdMs: IDLE_STAY_MS },
    ])
    state.mugs.delete(chosen.def.id)
  }
}

/** The next idle walk a person is due, drawn the first time it is asked. */
function idleDueOf(state: LifeState, actor: ActorState, step: { nowMs: number }): number {
  const held = state.idleAt.get(actor.def.id)

  if (held !== undefined) {
    return held
  }

  const due = step.nowMs + drawBetween(IDLE_WALK_GAP_MS, 'idle-gap', actor.def.id)

  state.idleAt.set(actor.def.id, due)

  return due
}

/** After an idle walk ends, the person's next one waits a gap of its own. */
export function resetIdle(state: LifeState, actor: ActorId, nowMs: number): void {
  state.idleAt.set(actor, nowMs + drawBetween(IDLE_WALK_GAP_MS, 'idle-gap', actor, String(nowMs)))
}

/** The afternoon coffee: up to two free people a floor fetch a mug from the pantry. */
export function stepCoffee(state: LifeState, step: LifeStep): void {
  const isAfternoon = isInRange(step.clock.minute, step.pack.coffee)

  if (!(step.isCalm && (isAfternoon || step.isRelaxed))) {
    return
  }

  fetchFromPantry(state, step, {
    kind: 'coffee',
    tag: isAfternoon ? COFFEE_TAG : COFFEE_CLOSE_TAG,
    max: COFFEE_MAX,
    percent: COFFEE_PICK_PERCENT,
    holdMs: COFFEE_HOLD_MS,
    gapMs: COFFEE_GAP_MS,
    line: COFFEE_LINE,
  })
}

/** Friday's dessert cart: while it stands in the pantry, free people fetch a cup from it. */
export function stepDessert(state: LifeState, step: LifeStep): void {
  const { dessert } = step.pack
  const sinceMin = step.clock.minute - dessert.at
  const isFetchTime = sinceMin >= 0 && sinceMin < dessert.stayMin - DESSERT_LAST_FETCH_MIN

  if (
    !step.isCalm ||
    step.clock.dow !== dessert.dow ||
    !isFetchTime ||
    state.cart.at === undefined
  ) {
    return
  }

  fetchFromPantry(state, step, {
    kind: 'dessert',
    tag: 'dessert',
    max: DESSERT_MAX,
    percent: COFFEE_PICK_PERCENT,
    holdMs: DESSERT_HOLD_MS,
    gapMs: DESSERT_GAP_MS,
    line: DESSERT_LINE,
  })
}

interface PantryRun {
  readonly kind: Extract<MomentKind, 'coffee' | 'dessert'>
  /** What each person is picked and counted done by for the day: the after-close coffee is its own
   *  round. */
  readonly tag: string
  readonly max: number
  readonly percent: number
  readonly holdMs: { readonly min: number; readonly max: number }
  readonly gapMs: { readonly min: number; readonly max: number }
  readonly line: 'coffee' | 'friday'
}

function fetchFromPantry(state: LifeState, step: LifeStep, run: PantryRun): void {
  const day = step.clock.day

  for (const floor of floorsOf(step)) {
    const gapKey = `${floor}:${run.kind}`
    const active = momentsOn(state, { step, floor, kind: run.kind })
    const spot = PANTRY[floor].spots[active % PANTRY[floor].spots.length]
    const isWaiting = step.nowMs < (state.gaps.get(gapKey) ?? 0)

    if (
      isWaiting ||
      active >= run.max ||
      spot === undefined ||
      hasTripOn(state, { step, floor, kind: run.kind })
    ) {
      continue
    }

    const actor = seatedFree(step, floor).find((candidate) => {
      const at = { actor: candidate.def.id, tag: run.tag, day }

      return isPicked(at, run.percent) && !isDoneToday(state, at)
    })

    if (actor === undefined) {
      continue
    }

    markDone(state, { actor: actor.def.id, tag: run.tag, day })
    state.gaps.set(gapKey, step.nowMs + drawBetween(run.gapMs, gapKey, String(step.nowMs)))
    const line: LifeLine = { actor: actor.def.id, label: run.line }

    begin(state, { actor, kind: run.kind, nowMs: step.nowMs, line, item: 'cup' }, [
      { at: spot.at, pose: 'idle', holdMs: drawBetween(run.holdMs, run.kind, actor.def.id, day) },
    ])
  }
}

/** The mid-afternoon stretch: one or two free people a floor yawn once, with no bubble. */
export function stepYawn(state: LifeState, step: LifeStep): void {
  const day = step.clock.day

  if (step.isReduced || !isInRange(step.clock.minute, step.pack.yawn)) {
    return
  }

  for (const floor of floorsOf(step)) {
    const gapKey = `${floor}:yawn`
    const yawned = [...step.actors.values()].filter(
      (each) =>
        each.def.floor === floor && isDoneToday(state, { actor: each.def.id, tag: 'yawn', day })
    ).length
    const actor = seatedFree(step, floor).find((candidate) => {
      const at = { actor: candidate.def.id, tag: 'yawn', day }

      return isPicked(at, YAWN_PICK_PERCENT) && !isDoneToday(state, at)
    })

    if (actor === undefined || yawned >= YAWN_MAX || step.nowMs < (state.gaps.get(gapKey) ?? 0)) {
      continue
    }

    markDone(state, { actor: actor.def.id, tag: 'yawn', day })
    state.gaps.set(gapKey, step.nowMs + drawBetween(YAWN_GAP_MS, gapKey, day))
    state.director.play(actor.def.id, { pose: 'yawn', ms: YAWN_MS })
  }
}

/** Two free people on a floor with nothing else going on sit on the sofa, turned to each other. */
export function stepChat(state: LifeState, step: LifeStep): void {
  if (!step.isCalm) {
    return
  }

  const gapMs = step.isRelaxed ? CHAT_GAP_MS / 2 : CHAT_GAP_MS

  for (const floor of floorsOf(step)) {
    const gapKey = `${floor}:chat`
    const [a, b] = seatedFree(step, floor)
    const seats = SOFA_SEATS[floor]
    const isWaiting = step.nowMs < (state.gaps.get(gapKey) ?? step.nowMs + gapMs)

    if (!state.gaps.has(gapKey)) {
      state.gaps.set(gapKey, step.nowMs + gapMs)
    }

    if (a === undefined || b === undefined || isWaiting || momentsOn(state, { step, floor }) > 0) {
      continue
    }

    state.gaps.set(gapKey, step.nowMs + gapMs)

    for (const [actor, partner, seat] of [
      [a, b, seats[0]],
      [b, a, seats[1]],
    ] as const) {
      const line: LifeLine = { actor: actor.def.id, label: CHAT_LINE }

      begin(state, { actor, kind: 'chat', nowMs: step.nowMs, line }, [
        { at: seat.at, pose: 'chat', face: partner.def.id, holdMs: CHAT_HOLD_MS },
      ])
    }
  }
}

/** When the next idle check or pantry departure could start something. */
export function scheduleDueOf(state: LifeState, step: LifeStep): number {
  if (!step.isCalm) {
    return Number.POSITIVE_INFINITY
  }

  const idleDues = step.free.map((actor) =>
    Math.max(idleDueOf(state, actor, step), state.idleCheckAt)
  )
  const gapDues = [...state.gaps.values()].filter((at) => at > step.nowMs)

  return Math.min(...idleDues, ...gapDues, Number.POSITIVE_INFINITY)
}

interface Begin {
  readonly actor: ActorState
  readonly kind: MomentKind
  readonly nowMs: number
  readonly line?: LifeLine
  readonly item?: 'cup'
}

/** Starts a moment of `stops` for the person, unless one of theirs is under way already. */
export function begin(
  state: LifeState,
  start: Begin,
  stops: readonly [StopSpec, ...StopSpec[]]
): void {
  const [first, ...rest] = stops
  const id = start.actor.def.id
  const { line } = start

  if (state.moments.has(id) || state.director.away.has(id)) {
    return
  }
  const moment = beginMoment(state.director, {
    kind: start.kind,
    actor: id,
    stops: [toStop(first, start.nowMs), ...rest.map((stop) => toStop(stop, start.nowMs))],
    index: 0,
    holdUntil: undefined,
    ...(line === undefined ? {} : { line }),
    ...(start.item === undefined ? {} : { item: start.item }),
  })

  state.moments.set(id, moment)
}

/** The floors that have people on them. */
function floorsOf(step: LifeStep): FloorId[] {
  return [...new Set([...step.actors.values()].map((actor) => actor.def.floor))]
}

// Another trip of the page's own (an idle walk, a chat) holds the floor's pantry runs back.
function hasTripOn(
  state: LifeState,
  on: { readonly step: LifeStep; readonly floor: FloorId; readonly kind: MomentKind }
): boolean {
  return momentsOn(state, { step: on.step, floor: on.floor }) > momentsOn(state, on)
}

// A non-work place on the floor, never beside anyone at work.
function placeFor(step: LifeStep, floor: FloorId, slot: string): Point | undefined {
  const working = [...step.actors.values()]
    .filter((actor) => actor.goal?.kind === 'work')
    .map((actor) => actor.walker.pos)
  const places = propsOn(floor)
    .filter((prop) => IDLE_PLACES.has(prop.kind))
    .map(approachOf)
    .filter((at) => working.every((pos) => distance(pos, at) >= IDLE_WORK_CLEAR_PX))
  const [first, ...rest] = places

  return first === undefined
    ? undefined
    : createRng(seedOf('idle-place', floor, slot)).pick([first, ...rest])
}
