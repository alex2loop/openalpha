import type { Critter } from '@/web/scene/sim/street/critters'
import type { CritterKind, CritterPose } from '@/web/scene/street-types'
import type { createRng } from '@/web/scene/world/rng'

/** A walk cycle's frames, and a wing beat's. */
export const WALK_FRAMES = 4

type Rng = ReturnType<typeof createRng>

/** A span of time: at least `min`, up to `span` more. */
export interface Span {
  readonly min: number
  readonly span: number
}

/** An animal at `home` (a sparrow's perch), at rest. */
export function createCritter(
  kind: CritterKind,
  home: { readonly x: number; readonly y: number; readonly flock: number }
): Critter {
  return {
    kind,
    pose: 'stand',
    frame: 0,
    facing: 1,
    lift: 0,
    lead: undefined,
    prev: { x: home.x, y: home.y },
    at: { x: home.x, y: home.y },
    home: { x: home.x, y: home.y },
    flock: home.flock,
    state: 'rest',
    t0: 0,
    nextAt: 0,
    until: 0,
    from: home.x,
    tx: home.x,
    dist: 0,
    isShown: false,
    hasChanged: false,
  }
}

/** At rest on the ground in `pose` for a while. */
export function rest(
  critter: Critter,
  at: { readonly pose: CritterPose; readonly nowMs: number; readonly rng: Rng; readonly ms: Span }
): void {
  critter.state = 'rest'
  critter.pose = at.pose
  critter.frame = 0
  critter.lift = 0
  critter.nextAt = at.nowMs + at.ms.min + at.rng.next() * at.ms.span
}

/** Along the ground toward `tx` at its pace, facing it; the frame from the distance walked. */
export function walkTo(
  critter: Critter,
  at: { readonly pxPerS: number; readonly dt: number; readonly pxPerFrame: number }
): void {
  const left = critter.tx - critter.at.x
  const step = at.pxPerS * at.dt

  if (Math.abs(left) <= step) {
    critter.at.x = critter.tx
  } else {
    critter.facing = left > 0 ? 1 : -1
    critter.at.x += critter.facing * step
  }

  critter.dist += Math.min(step, Math.abs(left))
  critter.frame = Math.floor(critter.dist / at.pxPerFrame) % WALK_FRAMES
}

export function flip(facing: -1 | 1): -1 | 1 {
  return facing > 0 ? -1 : 1
}

/** A whole number of `frameMs` beats since the page started, as a frame of `frames`. */
export function beatOf(
  nowMs: number,
  at: { readonly frameMs: number; readonly frames: number }
): number {
  return Math.floor(nowMs / at.frameMs) % at.frames
}
