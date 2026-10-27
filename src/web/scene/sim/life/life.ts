import type { ReadonlySignal } from '@preact/signals'

import type { Director } from '@/web/scene/sim/director'
import type {
  ActorId,
  ActorStatus,
  ActorView,
  DeskView,
  LifeLine,
  LifeView,
  SteamView,
} from '@/web/scene/types'
import { pageMinute } from '@/web/scene/clock/clock'
import { regionPack } from '@/web/scene/data/home'
import { startTodayRuns } from '@/web/scene/data/today-runs'
import { distance } from '@/web/scene/sim/actors/nav'
import { ASSISTANT } from '@/web/scene/sim/actors/roster'
import { isOfficeOpen } from '@/web/scene/sim/director'
import { CART_FLOOR, stepCart } from '@/web/scene/sim/life/cart'
import { createCrewState, crewDueOf, stepCrew } from '@/web/scene/sim/life/crew'
import { createDesks, deskDueOf, keepCup, stepDesks } from '@/web/scene/sim/life/desks'
import { stepErrands } from '@/web/scene/sim/life/errand-home'
import { stepAsks, subscribeLife } from '@/web/scene/sim/life/events'
import { dueOwners, isFree, statusesOf } from '@/web/scene/sim/life/free'
import { stepGatherings } from '@/web/scene/sim/life/gatherings'
import { lineOf, type MomentKind, momentDueOf, stepMoment } from '@/web/scene/sim/life/moments'
import { PET_FLOOR } from '@/web/scene/sim/life/pet-paths'
import { createPets } from '@/web/scene/sim/life/pets'
import { createRhythmState, stepPresence } from '@/web/scene/sim/life/presence'
import { createPrintTray, stepPrintTray } from '@/web/scene/sim/life/printer'
import { isRoundFree, roundDueOf, stepRounds } from '@/web/scene/sim/life/rounds'
import {
  resetIdle,
  scheduleDueOf,
  stepCoffee,
  stepDessert,
  stepIdle,
  stepYawn,
} from '@/web/scene/sim/life/schedule'
import { fidgetDueOf, postureLineOf, stepFidgets, stepPostures } from '@/web/scene/sim/life/seat'
import { type LifeState, type LifeStep, PET_AWAKE_MS } from '@/web/scene/sim/life/state'
import { stepChat } from '@/web/scene/sim/life/talk'
import { SIM_STEP_MS } from '@/web/scene/sim/loop'
import { approachOf } from '@/web/scene/sim/places'
import { moment as marketMoment, stepBell } from '@/web/scene/sim/rhythm'
import { propsOn } from '@/web/scene/world/props'
import { onWireEvent } from '@/web/state/events'
import { pending, runningCount, runs } from '@/web/state/live'

interface LifeDeps {
  readonly director: Director
  readonly teamDesks: () => readonly DeskView[]
  readonly reduced: ReadonlySignal<boolean>
}

/** The office life over the director's people: moments for the free, the pets, the cart, the
 *  printer, the bell. Stepped with the sim; it holds no timer of its own. */
export interface Life {
  step(index: number): boolean
  /** The next moment something of the office life is due, a `performance.now()` instant. */
  nextDueAt(): number
  view(): LifeView
  /** Back from a hidden spell: what the wire asked meanwhile is dropped, never replayed. */
  resume(): void
  /** The dot over each person's head, for those who show one. */
  statuses(views: readonly ActorView[]): ReadonlyMap<ActorId, ActorStatus>
  dispose(): void
}

const QUIET_AFTER_MS = 900_000
const PANTRY_LIVE_PX = 28
// The moments that are a break: an idle walk, a coffee, a dessert, a chat.
const BREAK_KINDS: ReadonlySet<MomentKind> = new Set(['idle', 'coffee', 'dessert', 'chat'])
const STEAM_KINDS = Object.freeze({ coffee: 'mug', cooler: 'cooler' } as const)
// Each floor's break things: the mugs on the coffee bars and the water coolers.
const BREAK_PROPS = (['office', 'team'] as const).flatMap((floor) =>
  propsOn(floor).flatMap((prop) =>
    prop.kind === 'coffee' || prop.kind === 'cooler'
      ? [
          {
            floor,
            kind: STEAM_KINDS[prop.kind],
            at: approachOf(prop),
            top: { x: prop.draw.x + prop.draw.w / 2, y: prop.draw.y },
          },
        ]
      : []
  )
)

export function createLife(deps: LifeDeps): Life {
  const state = createLifeState(deps, performance.now())
  const off = subscribeLife(onWireEvent, state)
  const stopRuns = startTodayRuns()
  let isDisposed = false
  let last: LifeStep | undefined
  // The view and the deadline between steps read the last step's people, at the time now.
  const current = (): LifeStep =>
    last === undefined ? readStep(state, deps) : { ...last, nowMs: performance.now() }

  return {
    step: () => {
      if (isDisposed) {
        return false
      }

      last = readStep(state, deps)

      return stepLife(state, last)
    },
    nextDueAt: () => (isDisposed ? Number.POSITIVE_INFINITY : dueOf(state, current())),
    view: () => viewOf(state, current()),
    statuses: (views) => statusesOf(state, views),
    resume: () => {
      last = undefined
      state.asks.length = 0
      state.rhythm.seenAt = undefined
    },
    dispose: () => {
      if (!isDisposed) {
        isDisposed = true
        off()
        stopRuns()
        endAll(state)
      }
    },
  }
}

function createLifeState(deps: LifeDeps, nowMs: number): LifeState {
  return {
    director: deps.director,
    teamDesks: deps.teamDesks,
    pets: createPets(nowMs),
    moments: new Map(),
    done: new Map(),
    idleAt: new Map(),
    fidgetAt: new Map(),
    gaps: new Map(),
    mugs: new Set(),
    failed: new Set(),
    verdicts: new Map(),
    woken: new Map(),
    asks: [],
    runNames: new Map(),
    finishes: new Map(),
    cart: { at: undefined, rollFrom: undefined, isLeaving: false, isBlocking: false },
    blocks: new Map(),
    crew: createCrewState(),
    desks: createDesks(),
    rhythm: createRhythmState(),
    round: { freeSince: undefined, lastAt: undefined, count: 0 },
    printTray: createPrintTray(),
    catAwakeUntil: 0,
    corgiAwakeUntil: nowMs + PET_AWAKE_MS,
    lastBusyAt: nowMs,
    lastPhase: undefined,
    idleCheckAt: nowMs,
  }
}

function readStep(state: LifeState, deps: LifeDeps): LifeStep {
  const nowMs = performance.now()
  const { actors, crew } = deps.director.staffAndCrew()
  const isReduced = deps.reduced.value
  const isQuiet = nowMs - state.lastBusyAt >= QUIET_AFTER_MS
  const canWalk = !(isReduced || document.hidden) && isOfficeOpen()
  const { noTrips, closingAuction, relaxed } = marketMoment.value
  const due = dueOwners()
  const free = { errands: deps.director.errands, due }

  return {
    nowMs,
    clock: pageMinute.value,
    actors,
    crew,
    free: [...actors.values()].filter(
      (actor) => isFree(actor, free) && !state.moments.has(actor.def.id)
    ),
    pack: regionPack.value.officeLife,
    canWalk,
    isCalm: canWalk && !isQuiet && !noTrips && !closingAuction,
    isQuiet,
    isRelaxed: relaxed,
    isReduced,
    due,
  }
}

function stepLife(state: LifeState, step: LifeStep): boolean {
  noteBusy(state, step)
  stepPrintTray(state.printTray, step.clock)
  clearFailed(state, step)
  stepPresence(state, step)
  stepCrew(state, step)

  const isMoving = stepCart(state, step)

  stepErrands(state, step)
  stepAsks(state, step)
  stepMoments(state, step)
  stepRounds(state, step)
  stepBell(state, step)
  stepGatherings(state, step)
  stepIdle(state, step)
  stepCoffee(state, step)
  stepDessert(state, step)
  stepChat(state, step)
  stepYawn(state, step)
  stepPostures(state, step)
  stepFidgets(state, step)
  stepDesks(state, step)

  const isPetMoving = state.pets.step(petWorldOf(state, step))

  return isMoving || isPetMoving
}

// Each running moment steps; one whose person stopped being free ends at once, and they walk back
// by nav (or stay seated) under whatever goal the live store gives them.
function stepMoments(state: LifeState, step: LifeStep): void {
  const free = { errands: state.director.errands, due: step.due }

  for (const [id, moment] of state.moments) {
    const actor = step.actors.get(id)
    const isStillFree =
      actor !== undefined && (id === ASSISTANT ? isRoundFree(actor) : isFree(actor, free))

    if (actor === undefined || !isStillFree || !step.canWalk) {
      endMoment(state, id)
      continue
    }

    if (stepMoment(state.director, moment, { actor, nowMs: step.nowMs }) === 'done') {
      endMoment(state, id)

      if (moment.item === 'cup') {
        keepCup(state, id)
      }

      if (moment.kind === 'idle') {
        resetIdle(state, id, step.nowMs)
      }
    }
  }
}

function endMoment(state: LifeState, id: ActorId): void {
  state.moments.delete(id)
  state.director.setLife(id, undefined)
}

function endAll(state: LifeState): void {
  for (const id of [...state.moments.keys()]) {
    endMoment(state, id)
  }

  for (const id of state.director.actors().keys()) {
    state.director.setLife(id, undefined)
  }
}

// Anything running, any request waiting or anyone typing keeps the office from going quiet.
function noteBusy(state: LifeState, step: LifeStep): void {
  const isTyping = [...step.actors.values()].some((actor) => actor.goal?.kind === 'work')

  if (runs.value.length > 0 || pending.value.length > 0 || isTyping) {
    state.lastBusyAt = step.nowMs
  }
}

// A red dot holds until the person's next run.
function clearFailed(state: LifeState, step: LifeStep): void {
  for (const id of state.failed) {
    if (step.actors.get(id)?.goal?.kind === 'work') {
      state.failed.delete(id)
    }
  }
}

function petWorldOf(state: LifeState, step: LifeStep): Parameters<LifeState['pets']['step']>[0] {
  return {
    nowMs: step.nowMs,
    dtMs: SIM_STEP_MS,
    people: [...step.actors.values()]
      .filter((actor) => actor.floor === PET_FLOOR)
      .map((actor) => actor.walker.pos),
    isQuiet: step.isQuiet,
    isCatAwake: step.nowMs < state.catAwakeUntil,
    isCorgiAwake: step.nowMs < state.corgiAwakeUntil,
    isWorking: runningCount.value > 0 && !step.isQuiet,
    isReduced: step.isReduced || document.hidden,
  }
}

function dueOf(state: LifeState, step: LifeStep): number {
  if (step.isReduced) {
    return Number.POSITIVE_INFINITY
  }

  const fidgets = step.isQuiet
    ? []
    : step.free.map((actor) => fidgetDueOf(state, actor.def.id, step.nowMs))
  const dues = [
    ...[...state.moments.values()].map(momentDueOf),
    ...fidgets,
    scheduleDueOf(state, step),
    roundDueOf(state, step),
    state.catAwakeUntil,
    state.corgiAwakeUntil,
    state.lastBusyAt + QUIET_AFTER_MS,
    state.pets.nextDueAt(petWorldOf(state, step)),
    deskDueOf(state.desks, step.nowMs),
    crewDueOf(state),
  ]

  return Math.min(...dues.filter((due) => due > step.nowMs), Number.POSITIVE_INFINITY)
}

function viewOf(state: LifeState, step: LifeStep): LifeView {
  const world = petWorldOf(state, step)
  const cart = state.cart.at

  const steam = step.isReduced ? [] : steamOf(state, step)

  return {
    pets: state.pets.views(world),
    fish: state.pets.fish(world),
    sheets: state.printTray.count,
    steam,
    animatedFloors: [
      ...new Set([
        ...steam.map((one) => one.floor),
        ...(state.pets.isSwimming() ? [PET_FLOOR] : []),
      ]),
    ],
    isQuiet: step.isQuiet,
    lines: linesOf(state, step),
    deskItems: state.desks.shown,
    occupied: state.rhythm.occupied,
    ...(state.crew.sign === undefined ? {} : { wetSign: state.crew.sign }),
    ...(cart === undefined ? {} : { cart: { floor: CART_FLOOR, at: cart } }),
    ...(state.printTray.feedAt === undefined ? {} : { feedAt: state.printTray.feedAt }),
  }
}

// Steam rises over a break mug, and a cooler bubbles, only while someone on a break stands by it.
function steamOf(state: LifeState, step: LifeStep): SteamView[] {
  const onBreak = [...state.moments.values()].flatMap((moment) => {
    const actor = BREAK_KINDS.has(moment.kind) ? step.actors.get(moment.actor) : undefined

    return actor === undefined ? [] : [{ floor: actor.def.floor, at: actor.walker.pos }]
  })

  return BREAK_PROPS.filter((prop) =>
    onBreak.some(
      (person) => person.floor === prop.floor && distance(person.at, prop.at) <= PANTRY_LIVE_PX
    )
  ).map((prop) => ({ floor: prop.floor, kind: prop.kind, at: prop.top }))
}

function linesOf(state: LifeState, step: LifeStep): LifeLine[] {
  const lines: LifeLine[] = []

  for (const actor of step.actors.values()) {
    const moment = state.moments.get(actor.def.id)
    const line = moment === undefined ? postureLineOf(step, actor) : lineOf(moment)

    if (line !== undefined) {
      lines.push(line)
    }
  }

  return [...lines, ...state.rhythm.lines]
}
