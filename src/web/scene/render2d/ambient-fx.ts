import type { SimView } from '@/web/scene/types'
import { AMBIENT_FX_FPS } from '@/web/scene/budgets'
import { alertStrip } from '@/web/scene/data/alert-strip'
import { roomStatus } from '@/web/scene/data/room-status'
import { fill } from '@/web/scene/render2d/building'
import { STANDBY_STEP_MS } from '@/web/scene/render2d/standby'
import { createRng, seedOf } from '@/web/scene/world/rng'
import { APPROVAL_KIND, pending, runningCount } from '@/web/state/live'
import { reducedMotion, sceneView } from '@/web/state/prefs'
import { MS_PER_SECOND } from '@/web/text/time-units'

const AMBIENT_FX_GAP_MS = MS_PER_SECOND / AMBIENT_FX_FPS
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
    ms: Math.floor(nowMs / AMBIENT_FX_GAP_MS) * AMBIENT_FX_GAP_MS,
    dust:
      isOffice && sim.light.sun.altitudeDeg >= DUST_SUN_DEG && sim.light.cloud <= DUST_CLOUD_MAX,
    ribbons: isAwake && sim.life.occupied.has('meet'),
    strip: isOffice && alertStrip.value.isNew,
    cue: isOffice && pending.value.some((entry) => entry.kind === APPROVAL_KIND),
    rack: isAwake && roomStatus.value.get('store')?.runs[0] !== undefined,
    bubbles: isAwake && runningCount.value > 0,
    standby: isAwake,
    lift: sim.lift.direction !== 'still',
  }

  return isFast(fx) || fx.standby ? fx : undefined
}

/** When the ambient clock steps next, while the 2D floor shows any effect; `Infinity` otherwise
 *  (3D draws its own). */
export function nextAmbientFxAt(sim: SimView, nowMs: number): number {
  const fx = sceneView.value === '2d' ? resolveAmbientFx(sim, nowMs) : undefined

  if (fx === undefined) {
    return Number.POSITIVE_INFINITY
  }

  // With only the StandBy colour on, the loop wakes at its slower step, not every beat.
  const gap = isFast(fx) ? AMBIENT_FX_GAP_MS : STANDBY_STEP_MS

  return (Math.floor(nowMs / gap) + 1) * gap
}

function isFast(fx: AmbientFx): boolean {
  return fx.dust || fx.ribbons || fx.strip || fx.cue || fx.rack || fx.bubbles || fx.lift
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
