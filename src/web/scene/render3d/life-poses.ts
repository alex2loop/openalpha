import type { PoseId } from '@/web/scene/types'

type Turn = readonly [number, number, number]

/** A mockup life pose in 3D: the body's lean, the head's nod and turn, and the four arm joints. */
export interface LifePose {
  readonly lean: number
  readonly headX: number
  readonly headY: number
  readonly ua: readonly [Turn, Turn]
  readonly fa: readonly [Turn, Turn]
}

// The mockup's `LIFE_POSE` values (radians) for the poses the sim now plays as one frame; the head
// turns aside by `headY` times the person's side.
const LIFE_POSES: Readonly<Partial<Record<PoseId, LifePose>>> = Object.freeze({
  stand: {
    lean: 0,
    headX: -0.08,
    headY: 0,
    ua: [
      [-0.5, 0, -0.15],
      [-0.5, 0, 0.15],
    ],
    fa: [
      [-1.35, 0, 0.95],
      [-1.35, 0, -0.95],
    ],
  },
  point: {
    lean: 0,
    headX: -0.12,
    headY: 0,
    ua: [
      [-0.5, 0, -0.15],
      [-1.45, 0, 0.28],
    ],
    fa: [
      [-1.2, 0, 0.9],
      [-0.15, 0, 0],
    ],
  },
  watch: {
    lean: 0.22,
    headX: 0.3,
    headY: 0,
    ua: [
      [-0.45, 0, -0.12],
      [-0.9, 0, 0.12],
    ],
    fa: [
      [-0.9, 0, 0.4],
      [-1.7, 0, -0.3],
    ],
  },
  chat: {
    lean: 0.04,
    headX: 0,
    headY: 0,
    ua: [
      [-0.45, 0, -0.1],
      [-0.6, 0, 0.12],
    ],
    fa: [
      [-1.2, 0, 0.5],
      [-1, 0, -0.2],
    ],
  },
  yawn: {
    lean: -0.18,
    headX: -0.4,
    headY: 0,
    ua: [
      [0, 0, -2.8],
      [0, 0, 2.8],
    ],
    fa: [
      [0, 0, -0.1],
      [0, 0, 0.1],
    ],
  },
})

/** The mockup's 3D life pose for `pose`, when it has one. */
export function lifePoseOf(pose: PoseId): LifePose | undefined {
  return LIFE_POSES[pose]
}
