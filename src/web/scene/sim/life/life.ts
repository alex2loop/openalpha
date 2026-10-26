import type { ReadonlySignal } from '@preact/signals'

import type { ActorState, Director } from '@/web/scene/sim/director'
import type { LifeState, LifeStep } from '@/web/scene/sim/life/state'
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
import { type AgendaRow, agenda } from '@/web/scene/data/agenda'
import { regionPack } from '@/web/scene/data/home'
import { breachedStops } from '@/web/scene/data/room-status'
import { startTodayRuns } from '@/web/scene/data/today-runs'
import { distance } from '@/web/scene/sim/actors/nav'
import { ASSISTANT, rosterDefOf } from '@/web/scene/sim/actors/roster'
import { isOfficeOpen } from '@/web/scene/sim/director'
import { CART_FLOOR, stepCart } from '@/web/scene/sim/life/cart'
import { addCup, createDesks, deskDueOf, stepDesks } from '@/web/scene/sim/life/desks'
import { stepAsks, subscribeLife } from '@/web/scene/sim/life/events'
import { lineOf, type MomentKind, momentDueOf, stepMoment } from '@/web/scene/sim/life/moments'
import { PET_FLOOR } from '@/web/scene/sim/life/pet-paths'
import { createPets } from '@/web/scene/sim/life/pets'
import { isRoundFree, roundDueOf, stepRounds } from '@/web/scene/sim/life/rounds'
import {
  resetIdle,
  scheduleDueOf,
  stepChat,
  stepCoffee,
  stepDessert,
  stepIdle,
  stepYawn,
} from '@/web/scene/sim/life/schedule'
import { fidgetDueOf, postureLineOf, stepFidgets, stepPostures } from '@/web/scene/sim/life/seat'
import { SIM_STEP_MS } from '@/web/scene/sim/loop'
import { approachOf } from '@/web/scene/sim/places'
import { stepBell } from '@/web/scene/sim/rhythm'
import { propsOn } from '@/web/scene/world/props'
import { isInRange } from '@/web/scene/world/regions'
import { onWireEvent } from '@/web/state/events'
import { pending, runs } from '@/web/state/live'
import { MINUTES_PER_HOUR, MS_PER_MINUTE } from '@/web/text/time-units'

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

/** A job within this of its run sits its owner up. */
const JOB_DUE_MS = 600_000
const NAP_DIM = 0.72
const QUIET_AFTER_MS = 900_000
const PANTRY_LIVE_PX = 28
const BRIEF_ROW_KEY = 'brief'
const BRIEF_OWNER: ActorId = 'pm'
const CLERK: ActorId = 'clerk'
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

  return {
    step: () => !isDisposed && stepLife(state, readStep(state, deps)),
    nextDueAt: () => (isDisposed ? Number.POSITIVE_INFINITY : dueOf(state, readStep(state, deps))),
    view: () => viewOf(state, readStep(state, deps)),
    statuses: (views) => statusesOf(state, views),
    resume: () => {
      state.asks.length = 0
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
    cart: { at: undefined, rollFrom: undefined, isLeaving: false, isBlocking: false },
    desks: createDesks(),
    round: { freeSince: undefined, lastAt: undefined, count: 0 },
    sheets: { hour: '', count: 0, feedAt: undefined },
    catAwakeUntil: 0,
    lastBusyAt: nowMs,
    lastPhase: undefined,
    idleCheckAt: nowMs,
  }
}

/** Free for the office life: no goal the live store calls for (no work, no approval or question,
 *  no walk to your desk), no gesture of a real event, no marker over the head, no job due within
 *  `JOB_DUE_MS`, not the mascot; staff only, never a temporary child or an own agent. */
function isFree(actor: ActorState): boolean {
  const id = actor.def.id
  const isMarked = id === CLERK && (breachedStops.value?.length ?? 0) > 0
  const hasBeat = actor.beats.some((beat) => beat.kind !== 'life')

  return (
    id !== ASSISTANT &&
    isStaffId(id) &&
    (actor.goal === undefined || actor.isLife) &&
    !hasBeat &&
    !isMarked &&
    !dueOwners().has(id)
  )
}

function readStep(state: LifeState, deps: LifeDeps): LifeStep {
  const nowMs = performance.now()
  const actors = deps.director.actors()
  const isReduced = deps.reduced.value
  const isQuiet = nowMs - state.lastBusyAt >= QUIET_AFTER_MS
  const canWalk = !(isReduced || document.hidden) && isOfficeOpen()
  const due = dueOwners()

  return {
    nowMs,
    clock: pageMinute.value,
    actors,
    free: [...actors.values()].filter((actor) => isFree(actor) && !state.moments.has(actor.def.id)),
    pack: regionPack.value.officeLife,
    canWalk,
    isCalm: canWalk && !isQuiet,
    isQuiet,
    isReduced,
    due,
  }
}

function stepLife(state: LifeState, step: LifeStep): boolean {
  noteBusy(state, step)
  clearSheets(state, step)
  clearFailed(state, step)

  const isMoving = stepCart(state, step)

  stepAsks(state, step)
  stepMoments(state, step)
  stepRounds(state, step)
  stepBell(state, step)
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
  for (const [id, moment] of state.moments) {
    const actor = step.actors.get(id)
    const isStillFree =
      actor !== undefined && (id === ASSISTANT ? isRoundFree(actor) : isFree(actor))

    if (actor === undefined || !isStillFree || !step.canWalk) {
      endMoment(state, id)
      continue
    }

    if (stepMoment(state.director, moment, { actor, nowMs: step.nowMs }) === 'done') {
      endMoment(state, id)

      if (moment.item === 'cup') {
        state.mugs.add(id)
        addCup(state.desks, id)
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

  state.director.setObstacles(CART_FLOOR, [])
}

// Anything running, any request waiting or anyone typing keeps the office from going quiet.
function noteBusy(state: LifeState, step: LifeStep): void {
  const isTyping = [...step.actors.values()].some((actor) => actor.goal?.kind === 'work')

  if (runs.value.length > 0 || pending.value.length > 0 || isTyping) {
    state.lastBusyAt = step.nowMs
  }
}

function clearSheets(state: LifeState, step: LifeStep): void {
  const hour = `${step.clock.day}:${Math.floor(step.clock.minute / MINUTES_PER_HOUR)}`

  if (state.sheets.hour !== hour) {
    state.sheets = { hour, count: 0, feedAt: undefined }
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
    state.lastBusyAt + QUIET_AFTER_MS,
    state.pets.nextDueAt(petWorldOf(state, step)),
    deskDueOf(state.desks, step.nowMs),
  ]

  return Math.min(...dues.filter((due) => due > step.nowMs), Number.POSITIVE_INFINITY)
}

function viewOf(state: LifeState, step: LifeStep): LifeView {
  const world = petWorldOf(state, step)
  const cart = state.cart.at

  const steam = step.isReduced ? [] : steamOf(state, step)

  return {
    pets: state.pets.views(world),
    fish: state.pets.fish(),
    sheets: state.sheets.count,
    steam,
    animatedFloors: [
      ...new Set([
        ...steam.map((one) => one.floor),
        ...(state.pets.isSwimming(world) ? [PET_FLOOR] : []),
      ]),
    ],
    isQuiet: step.isQuiet,
    lines: linesOf(state, step),
    deskItems: state.desks.shown,
    ...(cart === undefined ? {} : { cart: { floor: CART_FLOOR, at: cart } }),
    ...(state.sheets.feedAt === undefined ? {} : { feedAt: state.sheets.feedAt }),
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

  return lines
}

// No dot while someone works or walks to their work (the rim and the walk say so); red after an
// error until the next run; amber for an approval or a question, a carry owed, or a job due.
function statusesOf(
  state: LifeState,
  views: readonly ActorView[]
): ReadonlyMap<ActorId, ActorStatus> {
  const held = state.director.actors()
  const due = dueOwners()
  const statuses = new Map<ActorId, ActorStatus>()

  for (const view of views) {
    const actor = held.get(view.id)
    const status = actor === undefined || view.working ? undefined : statusOf(state, { actor, due })

    if (status !== undefined) {
      statuses.set(view.id, status)
    }
  }

  return statuses
}

function statusOf(
  state: LifeState,
  at: { readonly actor: ActorState; readonly due: ReadonlyMap<ActorId, AgendaRow> }
): ActorStatus | undefined {
  const { actor } = at
  const goal = actor.isLife ? undefined : actor.goal

  if (state.failed.has(actor.def.id)) {
    return 'failed'
  }

  if (goal?.requestId !== undefined || actor.isOwed || at.due.has(actor.def.id)) {
    return 'waiting'
  }

  return goal === undefined ? 'free' : undefined
}

// The owner of each job that runs within `JOB_DUE_MS` by the page clock: the brief is the
// manager's, a scheduled job its agent's.
function dueOwners(): ReadonlyMap<ActorId, AgendaRow> {
  const { rows } = agenda.value
  const now = pageMinute.value.minute
  const owners = new Map<ActorId, AgendaRow>()

  for (const row of rows) {
    const untilMs = (row.minute - now) * MS_PER_MINUTE
    const owner = row.key === BRIEF_ROW_KEY ? BRIEF_OWNER : row.agentId

    if (owner !== undefined && untilMs > 0 && untilMs <= JOB_DUE_MS && isStaffId(owner)) {
      owners.set(owner, row)
    }
  }

  return owners
}

function isStaffId(id: string): id is ActorId {
  return rosterDefOf(id) !== undefined
}

/** How far the lamps that are on glow: dimmed over the lunch nap by the page clock. */
export function lampGlowOf(): number {
  const isNap = isInRange(pageMinute.value.minute, regionPack.value.officeLife.nap)

  return isNap ? NAP_DIM : 1
}
