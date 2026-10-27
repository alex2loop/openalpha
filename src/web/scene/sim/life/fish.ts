import type { FishView } from '@/web/scene/types'
import { isAmbientBout, nextAmbientAt } from '@/web/scene/sim/actors/poses'
import { propsOn } from '@/web/scene/world/props'
import { MS_PER_SECOND } from '@/web/text/time-units'

/** What a fish's step reads: the sim's clock and step, reduced motion (every fish rests where it
 *  hangs), and a run working (the fish swim faster and bob deeper). */
interface FishWorld {
  readonly nowMs: number
  readonly dtMs: number
  readonly isReduced: boolean
  readonly isWorking: boolean
}

/** One fish: how far along its sweep, `u` (a sweep across the tank and back is two), its bob
 *  clock, and whether it swims; both clocks run only while it does. */
interface FishState {
  readonly pool: string
  readonly look: FishLook
  u: number
  bob: number
  isOn: boolean
  stepAt: number
}

// Each fish: its speed in px a second, its height in the water (0 to 1), its phase, where it
// hangs under reduced motion.
const FISH_LOOKS = Object.freeze([
  { speed: 10, height: 0.7, phase: 0, rest: 0.2 },
  { speed: 7, height: 0.15, phase: 2.1, rest: 1.5 },
  { speed: 13, height: 0.42, phase: 4.2, rest: 0.8 },
] as const)

type FishLook = (typeof FISH_LOOKS)[number]

const FISH_POOL = 'fish'
const TANK_PROP = propsOn('office').find((prop) => prop.kind === 'tank')
const TANK_W_PX = TANK_PROP?.rect.w ?? 36
// A fish keeps this much of the tank's width off its sweep, which one unit of `u` crosses.
const SWEEP_MARGIN_PX = 7
const SWEEP_SHARE = 0.5
// Slower when the office is calm.
const CALM_SPEED = 0.4
// A turn takes this share of a unit of `u`, centred on each end of the tank.
const TURN_SHARE = 0.07
const BOB_MS = 700
const BOB_DEPTH = Object.freeze({ working: 0.1, calm: 0.04 })
const BEAT_PER_S = Object.freeze({ working: 3.2, calm: 1.6 })
const BEAT_STEPS = 2
const YAW_STEPS = 16
const HALF = Math.PI
const SWEEP_UNITS = 2

export function createFish(): FishState[] {
  return FISH_LOOKS.map((look, i) => ({
    pool: `${FISH_POOL}:${i}`,
    look,
    u: look.phase,
    bob: 0,
    isOn: false,
    stepAt: 0,
  }))
}

/** A fish swims inside its own ambient bout and hangs still outside it; a bout that ends in the
 *  middle of a turn finishes the turn first. */
export function stepFish(fish: FishState, world: FishWorld): void {
  fish.stepAt = world.nowMs

  if (world.isReduced) {
    fish.isOn = false

    return
  }

  if (isAmbientBout(fish.pool, world.nowMs)) {
    fish.isOn = true
  } else if (fish.isOn && !isTurning(fish.u)) {
    fish.isOn = false
  }

  if (fish.isOn) {
    fish.u = (fish.u + sweepOf(fish, world.dtMs, world.isWorking)) % SWEEP_UNITS
    fish.bob += world.dtMs
  }
}

/** The next instant a bout of this fish starts or ends. */
export function fishDueAt(fish: FishState, nowMs: number): number {
  return nextAmbientAt(fish.pool, nowMs)
}

/** The fish as drawn now: a swimming one runs on from its last step by the time since. */
export function fishViewOf(fish: FishState, world: FishWorld): FishView {
  const ahead = fish.isOn ? Math.min(world.dtMs, Math.max(0, world.nowMs - fish.stepAt)) : 0
  const u = world.isReduced ? fish.look.rest : fish.u + sweepOf(fish, ahead, world.isWorking)
  const bob = world.isReduced ? 0 : fish.bob + ahead
  const mode = world.isWorking ? 'working' : 'calm'
  const m = ((u % SWEEP_UNITS) + SWEEP_UNITS) % SWEEP_UNITS
  const bobDepth = world.isReduced ? 0 : Math.sin(bob / BOB_MS + fish.look.phase) * BOB_DEPTH[mode]
  const beat = Math.sin((bob / MS_PER_SECOND) * BEAT_PER_S[mode] * Math.PI * 2 + fish.look.phase)

  return {
    k: m < 1 ? m : SWEEP_UNITS - m,
    depth: fish.look.height + bobDepth,
    yaw: Math.round(headingOf(m) / (HALF / (YAW_STEPS / 2))) % YAW_STEPS,
    tail: !world.isReduced && fish.isOn ? Math.round(BEAT_STEPS * beat) : 0,
  }
}

function sweepOf(fish: FishState, dtMs: number, isWorking: boolean): number {
  const speed = isWorking ? fish.look.speed : fish.look.speed * CALM_SPEED

  return (((dtMs / MS_PER_SECOND) * speed) / (TANK_W_PX - SWEEP_MARGIN_PX)) * SWEEP_SHARE
}

function isTurning(u: number): boolean {
  const m = ((u % SWEEP_UNITS) + SWEEP_UNITS) % SWEEP_UNITS

  return (
    m < TURN_SHARE || (m > 1 - TURN_SHARE && m < 1 + TURN_SHARE) || m > SWEEP_UNITS - TURN_SHARE
  )
}

// The heading in radians: 0 swimming right, half a turn swimming left, eased through each turn.
function headingOf(m: number): number {
  const e = TURN_SHARE

  if (m < e) {
    return HALF + HALF * smooth((m + e) / (2 * e))
  }

  if (m < 1 - e) {
    return 0
  }

  if (m < 1 + e) {
    return HALF * smooth((m - 1 + e) / (2 * e))
  }

  return m < SWEEP_UNITS - e ? HALF : HALF + HALF * smooth((m - SWEEP_UNITS + e) / (2 * e))
}

function smooth(v: number): number {
  const t = Math.min(1, Math.max(0, v))

  return t * t * (3 - 2 * t)
}
