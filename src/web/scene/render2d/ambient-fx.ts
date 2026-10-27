import type { SimView } from '@/web/scene/types'
import { AMBIENT_FX_GAP_MS, ambientMsOf } from '@/web/scene/budgets'
import { alertStrip } from '@/web/scene/data/alert-strip'
import { roomStatus } from '@/web/scene/data/room-status'
import { fill } from '@/web/scene/render2d/building'
import { STANDBY_STEP_MS } from '@/web/scene/render2d/standby'
import { PET_FLOOR } from '@/web/scene/sim/life/pet-paths'
import { createRng, seedOf } from '@/web/scene/world/rng'
import { APPROVAL_KIND, pending, runningCount } from '@/web/state/live'
import { reducedMotion, sceneView } from '@/web/state/prefs'

// Dust shows in the window light while the sun stands this high and the sky is this clear.
const DUST_SUN_DEG = 15
const DUST_CLOUD_MAX = 0.5
// The motes drifting in the north windows' light, each a fixed spot and phase, as the mockup seeds.
const DUST_SEED = 'dust'
const DUST = Object.freeze(
  Array.from({ length: 18 }, (_, i) => {
    const rng = createRng(seedOf(DUST_SEED, String(i)))

    return { x: 40 + rng.next() * 560, y: 36 + rng.next() * 90, phase: rng.next() * Math.PI * 2 }
  })
)
const DUST_ALPHA = 0.45
const DUST_SWAY_PX = 8
const DUST_SWAY_MS = 2600
const DUST_FALL_MS = 380
const DUST_FALL_PX = 70
const DUST_TONE = '#FFFFFF'

/** The floor's ambient effects this frame: `ms` is the one clock they all read, stepped at
 *  `AMBIENT_FX_FPS`; each flag says whether its effect is on. */
export interface AmbientFx {
  readonly ms: number
  readonly dust: boolean
  readonly ribbons: boolean
  readonly strip: boolean
  readonly cue: boolean
  readonly rack: boolean
  readonly bubbles: boolean
  /** A pet is inside its bout: it breathes, flicks an ear, glances and wags. */
  readonly pets: boolean
  /** The StandBy stands' drifting colour, which steps only every `STANDBY_STEP_MS`. */
  readonly standby: boolean
  /** The lift's arrow, blinking while the car rides, on either floor. */
  readonly lift: boolean
}

/** The ambient effects the floor shows now: the office's own, and the lift's arrow on either
 *  floor; none under reduced motion, where every effect draws its still frame. */
export function resolveAmbientFx(sim: SimView, nowMs: number): AmbientFx | undefined {
  if (reducedMotion.value) {
    return undefined
  }

  const isOffice = sim.floor === 'office'
  const isAwake = isOffice && !sim.life.isQuiet
  const fx = {
    ms: ambientMsOf(nowMs),
    dust:
      isOffice && sim.light.sun.altitudeDeg >= DUST_SUN_DEG && sim.light.cloud <= DUST_CLOUD_MAX,
    ribbons: isAwake && sim.life.occupied.has('meet'),
    strip: isOffice && alertStrip.value.isNew,
    cue: isOffice && pending.value.some((entry) => entry.kind === APPROVAL_KIND),
    rack: isAwake && roomStatus.value.get('store')?.runs[0] !== undefined,
    bubbles: isAwake && runningCount.value > 0,
    pets: isPetsStirring(sim),
    standby: isAwake,
    lift: sim.lift.direction !== 'still',
  }

  return isFast(fx) || fx.standby ? fx : undefined
}

/** When the ambient clock steps next, while the floor shows any effect; `Infinity` otherwise. The
 *  3D floor draws its own, but for the pets' idle moves, which ride the same clock. */
export function nextAmbientFxAt(sim: SimView, nowMs: number): number {
  if (sceneView.value === '3d') {
    return isPetsStirring(sim) ? nextBeatAt(nowMs, AMBIENT_FX_GAP_MS) : Number.POSITIVE_INFINITY
  }

  const fx = resolveAmbientFx(sim, nowMs)

  if (fx === undefined) {
    return Number.POSITIVE_INFINITY
  }

  // With only the StandBy colour on, the loop wakes at its slower step, not every beat.
  return nextBeatAt(nowMs, isFast(fx) ? AMBIENT_FX_GAP_MS : STANDBY_STEP_MS)
}

// A pet inside its bout, on the floor they live on.
function isPetsStirring(sim: SimView): boolean {
  return !reducedMotion.value && sim.floor === PET_FLOOR && sim.life.pets.some((pet) => pet.isLive)
}

function nextBeatAt(nowMs: number, gapMs: number): number {
  return (Math.floor(nowMs / gapMs) + 1) * gapMs
}

function isFast(fx: AmbientFx): boolean {
  return fx.dust || fx.ribbons || fx.strip || fx.cue || fx.rack || fx.bubbles || fx.pets || fx.lift
}

/** The dust in the window light, drifting on the ambient clock. */
export function paintDust(g: CanvasRenderingContext2D, fx: AmbientFx | undefined): void {
  if (fx?.dust !== true) {
    return
  }

  g.globalAlpha = DUST_ALPHA

  for (const mote of DUST) {
    const x = mote.x + DUST_SWAY_PX * Math.sin(fx.ms / DUST_SWAY_MS + mote.phase)
    const y = mote.y + ((fx.ms / DUST_FALL_MS + mote.phase * 9) % DUST_FALL_PX)

    fill(g, [Math.round(x), Math.round(y), 1, 1], DUST_TONE)
  }

  g.globalAlpha = 1
}
