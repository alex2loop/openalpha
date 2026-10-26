import type { SimView } from '@/web/scene/types'
import { AMBIENT_FX_FPS } from '@/web/scene/budgets'
import { alertStrip } from '@/web/scene/data/alert-strip'
import { roomStatus } from '@/web/scene/data/room-status'
import { fill } from '@/web/scene/render2d/building'
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

/** The office floor's ambient effects this frame: `ms` is the one clock they all read, stepped at
 *  `AMBIENT_FX_FPS`; each flag says whether its effect is on. */
export interface AmbientFx {
  readonly ms: number
  readonly dust: boolean
  readonly ribbons: boolean
  readonly strip: boolean
  readonly cue: boolean
  readonly rack: boolean
  readonly bubbles: boolean
}

/** The ambient effects the office floor shows now; none under reduced motion or on another floor,
 *  where every effect draws its still frame. */
export function resolveAmbientFx(sim: SimView, nowMs: number): AmbientFx | undefined {
  if (reducedMotion.value || sim.floor !== 'office') {
    return undefined
  }

  const isAwake = !sim.life.isQuiet
  const fx = {
    ms: Math.floor(nowMs / AMBIENT_FX_GAP_MS) * AMBIENT_FX_GAP_MS,
    dust: sim.light.sun.altitudeDeg >= DUST_SUN_DEG && sim.light.cloud <= DUST_CLOUD_MAX,
    ribbons: isAwake && sim.life.occupied.has('meet'),
    strip: alertStrip.value.isNew,
    cue: pending.value.some((entry) => entry.kind === APPROVAL_KIND),
    rack: isAwake && roomStatus.value.get('store')?.runs[0] !== undefined,
    bubbles: isAwake && runningCount.value > 0,
  }
  const isOn = fx.dust || fx.ribbons || fx.strip || fx.cue || fx.rack || fx.bubbles

  return isOn ? fx : undefined
}

/** When the ambient clock steps next, while the 2D floor shows any effect; `Infinity` otherwise
 *  (3D draws its own). */
export function nextAmbientFxAt(sim: SimView, nowMs: number): number {
  return sceneView.value !== '2d' || resolveAmbientFx(sim, nowMs) === undefined
    ? Number.POSITIVE_INFINITY
    : (Math.floor(nowMs / AMBIENT_FX_GAP_MS) + 1) * AMBIENT_FX_GAP_MS
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
