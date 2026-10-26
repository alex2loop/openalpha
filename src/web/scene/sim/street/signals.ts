import type { SignalHeadId, SignalLamp, SignalState } from '@/web/scene/types'
import { MS_PER_SECOND } from '@/web/text/time-units'

// The north street's phases; the side streets and the crossing run off the same cycle.
const GREEN_MS = 14_000
const AMBER_MS = 2_000
const RED_MS = 10_000
const CYCLE_MS = GREEN_MS + AMBER_MS + RED_MS
// Walkers step off a moment after the north turns red; the walk lamp flashes for the last stretch.
const WALK_LEAD_MS = 300
const FLASH_MS = 8_000
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
