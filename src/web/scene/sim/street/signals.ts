import type {
  SignalHeadId,
  SignalHeadView,
  SignalLamp,
  SignalState,
} from '@/web/scene/street-types'
import type { RegionPack } from '@/web/scene/world/regions'
import { flowsOf } from '@/web/scene/sim/street/flows'
import { CROSSING, KERB_Y, NORTH } from '@/web/scene/world/street-layout'
import { MS_PER_SECOND } from '@/web/text/time-units'

// The north street's phases; the side streets and the crossing run off the same cycle.
const GREEN_MS = 14_000
const AMBER_MS = 2_000
const RED_MS = 10_000
const CYCLE_MS = GREEN_MS + AMBER_MS + RED_MS
// Walkers step off a moment after the north turns red; the walk lamp flashes for the last stretch.
const WALK_LEAD_MS = 300
const FLASH_MS = 8_000
// Where the heads stand: a side head beside its kerb by the junction, a north head a little
// before its stop line on the far kerb, walk heads either side of the zebra on both kerbs.
const HEAD_KERB_PX = 2
const JUNCTION_HEAD_Y = NORTH.roadBottom + 6
const NORTH_HEAD_BACK = 1
const WALK_HEAD_X = 6.4
/** Every phase a head follows. */
export const SIGNAL_HEADS: readonly SignalHeadId[] = ['north', 'side', 'walk']
// The cycle is read in steps this long, so a sim step reuses the state it read before.
const TABLE_STEP_MS = 100

// Filled as each step of the cycle is first read; a full table holds one state per step.
const TABLES: Readonly<Record<SignalHeadId, SignalState[]>> = Object.freeze({
  north: [],
  side: [],
  walk: [],
})

/** The state of `head` at `now`, a sim-time instant, so the phases run at real speed under any
 *  preview speed. */
export function signalOf(head: SignalHeadId, now: number): SignalState {
  const phase = ((now % CYCLE_MS) + CYCLE_MS) % CYCLE_MS
  const index = Math.floor(phase / TABLE_STEP_MS)
  const table = TABLES[head]
  const held = table[index]

  if (held !== undefined) {
    return held
  }

  const state = Object.freeze(stateAt(head, index * TABLE_STEP_MS))

  table[index] = state

  return state
}

// The heads of each pack's road, built once per pack.
const HEADS_BY_PACK = new WeakMap<RegionPack, readonly SignalHeadView[]>()

/** Every signal head of the pack's road: one per north way and per side way heading for the
 *  north street, and the four walk heads at the crossing. */
export function signalHeadsOf(pack: RegionPack): readonly SignalHeadView[] {
  const held = HEADS_BY_PACK.get(pack)

  if (held !== undefined) {
    return held
  }

  const heads: SignalHeadView[] = []

  for (const flow of flowsOf(pack).all) {
    if (flow.street === 'north') {
      const x = CROSSING.x - flow.dir * (CROSSING.carLine - NORTH_HEAD_BACK)

      heads.push({ head: 'north', kind: 'car', at: { x, y: KERB_Y.far } })
    } else if (flow.dir < 0) {
      const x = flow.line + flow.halfWidth + HEAD_KERB_PX

      heads.push({ head: 'side', kind: 'car', at: { x, y: JUNCTION_HEAD_Y } })
    }
  }

  for (const y of [KERB_Y.far, KERB_Y.near]) {
    for (const side of [-1, 1]) {
      heads.push({ head: 'walk', kind: 'walk', at: { x: CROSSING.x + side * WALK_HEAD_X, y } })
    }
  }

  HEADS_BY_PACK.set(pack, heads)

  return heads
}

/** The first sim instant after `now` at which some head changes its lamp or its seconds. */
export function nextSignalChangeAt(now: number): number {
  const from = Math.floor(now / TABLE_STEP_MS) * TABLE_STEP_MS

  for (let at = from + TABLE_STEP_MS; at <= from + CYCLE_MS; at += TABLE_STEP_MS) {
    if (SIGNAL_HEADS.some((head) => !isSameSignal(signalOf(head, at), signalOf(head, from)))) {
      return at
    }
  }

  return from + CYCLE_MS
}

export function isSameSignal(a: SignalState, b: SignalState): boolean {
  return a.lamp === b.lamp && a.seconds === b.seconds
}

function stateAt(head: SignalHeadId, phase: number): SignalState {
  const redFrom = GREEN_MS + AMBER_MS

  if (head === 'north') {
    if (phase < GREEN_MS) {
      return toState('green', GREEN_MS - phase)
    }

    return phase < redFrom ? toState('amber', redFrom - phase) : toState('red', CYCLE_MS - phase)
  }

  if (head === 'walk') {
    if (phase < redFrom + WALK_LEAD_MS) {
      return toState('red', redFrom + WALK_LEAD_MS - phase)
    }

    return toState(phase < CYCLE_MS - FLASH_MS ? 'walk' : 'flash', CYCLE_MS - phase)
  }

  if (phase < redFrom) {
    return toState('red', redFrom - phase)
  }

  const amberFrom = CYCLE_MS - AMBER_MS

  return phase < amberFrom
    ? toState('green', amberFrom - phase)
    : toState('amber', CYCLE_MS - phase)
}

function toState(lamp: SignalLamp, msLeft: number): SignalState {
  return { lamp, seconds: Math.max(0, Math.ceil(msLeft / MS_PER_SECOND)) }
}
