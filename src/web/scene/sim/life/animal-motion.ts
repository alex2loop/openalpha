import type { PetKind } from '@/web/scene/types'

/** How an animal's parts sit in one frame, in the mockup's small whole steps so both renderers
 *  show the same few frames: `breath` 0 to 4 (2 at rest), `ear` a flick (0 to 2), `turn` the
 *  head's glance (-2 to 2), `tail` a wag or beat (-2 to 2), `yaw` a fish's heading in sixteenths
 *  of a circle, `step` a stride (-1 to 1), `pitch` the body's tilt in a jump (-2 to 2). */
export interface AnimalMotion {
  readonly breath: number
  readonly ear: number
  readonly turn: number
  readonly tail: number
  readonly yaw: number
  readonly step: number
  readonly pitch: number
}

/** What one pet shows now: `pose` is the model's (the cat sits, walks or sleeps; the corgi stands,
 *  lies or sleeps), `ms` the ambient clock, `isLive` whether its bout is on, `step` the stride the
 *  caller takes from the ground it covers, `air` and `pitch` a jump in flight. */
interface PetLook {
  readonly kind: PetKind
  readonly pose: string
  readonly level: number
  readonly ms: number
  readonly isLive: boolean
  readonly step: number
  readonly air: number
  readonly pitch: number
}

/** The animal as it rests: no breath, flick, glance, wag, stride or tilt. */
const REST_MOTION: AnimalMotion = Object.freeze({
  breath: 2,
  ear: 0,
  turn: 0,
  tail: 0,
  yaw: 0,
  step: 0,
  pitch: 0,
})

const TWO_PI = Math.PI * 2
const AMPLITUDE = 2
// Idle moves show from a room's detail up; the corgi's wag shows at every zoom.
const IDLE_DETAIL = 1
const BREATH_MS = Object.freeze({ sleep: 3_600, cat: 3_400, corgi: 4_200 })
const EAR_MS = Object.freeze({ cat: 7_100, corgi: 6_800 })
const EAR_FLICK = Object.freeze({ ms: 260, firstMs: 90, backMs: 180 })
const GLANCE_MS = Object.freeze({ cat: 12_600, corgi: 10_400, hold: 1_800 })
const WAG_MS = 85
const FLICK = Object.freeze({ everyMs: 4_400, ms: 700, swings: 3 })
// A body swells this much a breath step; a part swings this much a step.
const BREATH_SWELL = Object.freeze({ cat: 0.018, corgi: 0.012 })
const PITCH_TURN = 0.2
const EAR_TURN = 0.13
const GLANCE_TURN = 0.3
const TAIL_TURN = Object.freeze({ cat: 0.22, corgi: 0.3, fin: 0.2, rear: 0.16, front: 0.03 })
const STEP_SWING = 0.45
const YAW_STEPS = 16

/** The idle moves of a pet in `look`: breathing, an ear flick, a glance, the corgi's wag and the
 *  cat's tail flick, each only while the pet's own bout is on. */
export function petMotionOf(look: PetLook): AnimalMotion {
  const isIdle = look.isLive && look.level >= IDLE_DETAIL
  const isAwake = look.pose !== 'sleep'

  return {
    breath: isIdle ? breathOf(look) : REST_MOTION.breath,
    ear: isIdle && isAwake ? earOf(look) : 0,
    turn: isIdle && isAwake ? glanceOf(look) : 0,
    tail: tailOf(look),
    yaw: 0,
    step: look.air === 0 ? look.step : look.air,
    pitch: look.air === 0 ? 0 : look.pitch,
  }
}

/** A fish as the sim says: its heading and its tail's beat. */
export function fishMotionOf(fish: { readonly yaw: number; readonly tail: number }): AnimalMotion {
  return { ...REST_MOTION, yaw: fish.yaw, tail: fish.tail }
}

/** How a part turns about z (`az`, a swing) and y (`ay`, a heading) and stretches up (`sy`) in
 *  `motion`; the same in both renderers. */
export function partTurnOf(
  kind: string,
  name: string,
  motion: AnimalMotion
): { readonly az: number; readonly ay: number; readonly sy: number } {
  const isCat = kind === 'cat'

  if (name.startsWith('leg')) {
    const sign = name === 'legFa' || name === 'legBb' ? STEP_SWING : -STEP_SWING

    return { az: motion.step * sign, ay: 0, sy: 1 }
  }

  switch (name) {
    case 'body':
      return {
        az: motion.pitch * PITCH_TURN,
        ay: 0,
        sy:
          1 +
          (motion.breath - REST_MOTION.breath) * (isCat ? BREATH_SWELL.cat : BREATH_SWELL.corgi),
      }
    case 'head':
      return { az: 0, ay: motion.turn * GLANCE_TURN, sy: 1 }
    case 'ear':
      return { az: motion.ear * EAR_TURN, ay: 0, sy: 1 }
    case 'tail':
      return { az: 0, ay: motion.tail * (isCat ? TAIL_TURN.cat : TAIL_TURN.corgi), sy: 1 }
    case 'front':
      return {
        az: 0,
        ay: (motion.yaw * Math.PI) / (YAW_STEPS / 2) - motion.tail * TAIL_TURN.front,
        sy: 1,
      }
    case 'rear':
      return { az: 0, ay: motion.tail * TAIL_TURN.rear, sy: 1 }
    default:
      return { az: 0, ay: motion.tail * TAIL_TURN.fin, sy: 1 }
  }
}

function breathOf(look: PetLook): number {
  const awake = look.kind === 'cat' ? BREATH_MS.cat : BREATH_MS.corgi
  const period = look.pose === 'sleep' ? BREATH_MS.sleep : awake

  return REST_MOTION.breath + Math.round(AMPLITUDE * Math.sin((look.ms / period) * TWO_PI))
}

// A quick twitch: up, further up, up again.
function earOf(look: PetLook): number {
  const at = look.ms % (look.kind === 'cat' ? EAR_MS.cat : EAR_MS.corgi)

  if (at >= EAR_FLICK.ms) {
    return 0
  }

  return at < EAR_FLICK.firstMs || at >= EAR_FLICK.backMs ? 1 : 2
}

// A slow look to one side and back, to the other side the next time; a standing corgi keeps its
// head up.
function glanceOf(look: PetLook): number {
  const every = look.kind === 'cat' ? GLANCE_MS.cat : GLANCE_MS.corgi
  const at = look.ms % every

  if (at >= GLANCE_MS.hold || look.pose === 'stand') {
    return 0
  }

  const side = Math.floor(look.ms / every) % 2 === 1 ? 1 : -1

  return Math.round(AMPLITUDE * Math.sin((Math.PI * at) / GLANCE_MS.hold)) * side
}

function tailOf(look: PetLook): number {
  if (!look.isLive) {
    return 0
  }

  if (look.kind === 'corgi') {
    return look.pose === 'stand' ? Math.round(AMPLITUDE * Math.sin(look.ms / WAG_MS)) : 0
  }

  const at = look.ms % FLICK.everyMs
  const isFlicking =
    look.level >= IDLE_DETAIL && (look.pose === 'sit' || look.pose === 'walk') && at < FLICK.ms

  return isFlicking ? Math.round(AMPLITUDE * Math.sin((at / FLICK.ms) * Math.PI * FLICK.swings)) : 0
}
