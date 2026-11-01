import type { Joint } from '@/web/scene/render3d/figure'
import type { LifePose } from '@/web/scene/render3d/life-poses'
import type { Arms, PoseFrame } from '@/web/scene/sim/actors/poses'
import type { Dir } from '@/web/scene/types'

type Turn = readonly [number, number, number]

/** Where every joint wants to be this frame, and the body's own lean, bob and hop. */
export interface JointTargets {
  readonly joints: Readonly<Record<Joint, Turn>>
  readonly isShut: boolean
  readonly hop: number
}

/** What a pose is read against: the gait's swing (-1 to 1), how seated (0 to 1), the person's
 *  side for an aside glance, and whether the right hand carries something. */
interface PoseContext {
  readonly swing: number
  readonly sit: number
  readonly side: 1 | -1
  readonly isHolding: boolean
  readonly isWalking: boolean
  /** The mockup's life pose the person holds, read before the frame's arms. */
  readonly life?: LifePose
}

interface ArmPose {
  readonly ua: readonly [Turn, Turn]
  readonly fa: readonly [Turn, Turn]
}

const HALF_TURN = Math.PI / 2
const ARMS: Readonly<Record<Arms, ArmPose>> = Object.freeze({
  down: {
    ua: [
      [0, 0, -0.07],
      [0, 0, 0.07],
    ],
    fa: [
      [-0.1, 0, 0],
      [-0.1, 0, 0],
    ],
  },
  type: {
    ua: [
      [-0.75, 0, -0.1],
      [-0.75, 0, 0.1],
    ],
    fa: [
      [-0.95, 0, 0],
      [-0.95, 0, 0],
    ],
  },
  hand: {
    ua: [
      [0, 0, -0.07],
      [0, 0, 2.75],
    ],
    fa: [
      [-0.1, 0, 0],
      [0, 0, 0.15],
    ],
  },
  cheer: {
    ua: [
      [0, 0, -2.75],
      [0, 0, 2.75],
    ],
    fa: [
      [0, 0, -0.15],
      [0, 0, 0.15],
    ],
  },
  relax: {
    ua: [
      [0, 0, -1.55],
      [0, 0, 1.55],
    ],
    fa: [
      [0, 0, -2],
      [0, 0, 2],
    ],
  },
  cross: {
    ua: [
      [-0.45, 0, -0.12],
      [-0.9, 0, 0.12],
    ],
    fa: [
      [-0.9, 0, 0.4],
      [-1.7, 0, -0.3],
    ],
  },
  nap: {
    ua: [
      [-1.35, 0, -0.22],
      [-1.35, 0, 0.22],
    ],
    fa: [
      [-0.05, 0, 0.6],
      [-0.05, 0, -0.6],
    ],
  },
  shrug: {
    ua: [
      [0, 0, -0.6],
      [0, 0, 0.6],
    ],
    fa: [
      [-1.3, 0, 0.9],
      [-1.3, 0, -0.9],
    ],
  },
  scratch: {
    ua: [
      [0, 0, -0.07],
      [0, 0, 2.4],
    ],
    fa: [
      [-0.1, 0, 0],
      [0, 0, 1.9],
    ],
  },
  sip: {
    ua: [
      [0, 0, -0.07],
      [-0.45, 0, 0.12],
    ],
    fa: [
      [-0.1, 0, 0],
      [-1.7, 0, 0],
    ],
  },
})
// Hands rest in the lap when seated, a cup or a box is carried at the chest.
const LAP: ArmPose = {
  ua: [
    [-0.35, 0, -0.08],
    [-0.35, 0, 0.08],
  ],
  fa: [
    [-1.05, 0, 0],
    [-1.05, 0, 0],
  ],
}
const CARRY_R: readonly [Turn, Turn] = [
  [-0.45, 0, 0.12],
  [-1.15, 0, 0],
]
const PHONE_CALL_R: readonly [Turn, Turn] = [
  [2.808, 0, 1.02],
  [1.492, 0, -1.117],
]
const PHONE_READ: ArmPose = {
  ua: [
    [-0.778, 0, -0.089],
    [-0.778, 0, 0.089],
  ],
  fa: [
    [-0.928, 0, 0.804],
    [-0.928, 0, -0.804],
  ],
}
const TYPE_KEY = Object.freeze({ up: 0.16, down: -0.1 })
const WAVE_TURN = 0.45
const ARM_SWING = 0.6
const LEG_SWING = 0.7
const KNEE_SWING = 0.9
const STAND_KNEE = 0.03
const LEAN: Readonly<Partial<Record<Arms, number>>> = Object.freeze({ relax: -0.2, nap: 0.8 })
const SEATED_LEAN = 0.06
const HEAD_DOWN = 0.3
const HEAD_DROP_PER_PX = 0.1
const HEAD_ASIDE = 0.55
const HOP = 0.14
const FACE_YAW: Readonly<Record<Dir, number>> = Object.freeze({
  down: 0,
  up: Math.PI,
  left: -HALF_TURN,
  right: HALF_TURN,
})

/** The joints' targets for one pose frame. */
export function targetsOf(frame: PoseFrame, ctx: PoseContext): JointTargets {
  const { life } = ctx
  const arms = life ?? armsOf(frame, ctx)
  const lean = (life?.lean ?? LEAN[frame.arms ?? 'down'] ?? 0) + (ctx.sit > 0.5 ? SEATED_LEAN : 0)
  const headX = life?.headX ?? headPitchOf(frame)
  const headY = frame.isAside === true ? ctx.side * HEAD_ASIDE : 0

  return {
    joints: {
      ...legsOf(ctx),
      uaL: arms.ua[0],
      uaR: arms.ua[1],
      faL: arms.fa[0],
      faR: arms.fa[1],
      torso: [lean, 0, 0],
      head: [headX, headY, 0],
    },
    isShut: frame.isShut === true,
    hop: frame.isHop === true ? HOP : 0,
  }
}

function headPitchOf(frame: PoseFrame): number {
  if (frame.headDrop !== undefined) {
    return frame.headDrop * HEAD_DROP_PER_PX
  }

  return frame.isDown === true ? HEAD_DOWN : 0
}

/** Which way a person turns: along the path while walking, else the way they face, or to the
 *  camera when the pose turns them to the room. */
export function yawOf(spec: {
  readonly facing: Dir
  readonly step: readonly [number, number]
  readonly isFront: boolean
}): number {
  const [dx, dz] = spec.step

  if (dx !== 0 || dz !== 0) {
    return Math.atan2(dx, dz)
  }

  return spec.isFront ? 0 : FACE_YAW[spec.facing]
}

function legsOf(ctx: PoseContext): Pick<Record<Joint, Turn>, 'thL' | 'thR' | 'shL' | 'shR'> {
  const { swing, sit } = ctx
  const knee = (lift: number) =>
    lerp(ctx.isWalking ? Math.max(0, lift) * KNEE_SWING : STAND_KNEE, HALF_TURN, sit)

  return {
    thL: [lerp(swing * LEG_SWING, -HALF_TURN, sit), 0, 0],
    thR: [lerp(-swing * LEG_SWING, -HALF_TURN, sit), 0, 0],
    shL: [knee(-swing), 0, 0],
    shR: [knee(swing), 0, 0],
  }
}

function armsOf(frame: PoseFrame, ctx: PoseContext): ArmPose {
  if (frame.phone === 'read') {
    return PHONE_READ
  }

  const named = frame.arms ?? 'down'
  const base = named === 'down' && ctx.sit > 0.5 ? LAP : ARMS[named]

  if (frame.phone === 'call') {
    return { ua: [base.ua[0], PHONE_CALL_R[0]], fa: [base.fa[0], PHONE_CALL_R[1]] }
  }

  if (named === 'type') {
    const [key, rest] =
      frame.beat === 1 ? [TYPE_KEY.up, TYPE_KEY.down] : [TYPE_KEY.down, TYPE_KEY.up]

    return { ua: base.ua, fa: [nudge(base.fa[0], 0, key), nudge(base.fa[1], 0, rest)] }
  }

  if (named === 'hand' && frame.isWave === true) {
    return { ua: base.ua, fa: [base.fa[0], nudge(base.fa[1], 2, WAVE_TURN)] }
  }

  return named === 'down' ? downArms(base, ctx) : base
}

function downArms(base: ArmPose, ctx: PoseContext): ArmPose {
  if (ctx.isHolding && ctx.sit < 0.5) {
    return { ua: [base.ua[0], CARRY_R[0]], fa: [base.fa[0], CARRY_R[1]] }
  }

  if (!ctx.isWalking) {
    return base
  }

  const swing = ctx.swing * ARM_SWING

  return { ua: [nudge(base.ua[0], 0, -swing), nudge(base.ua[1], 0, swing)], fa: base.fa }
}

function nudge(turn: Turn, axis: 0 | 1 | 2, by: number): Turn {
  return [
    turn[0] + (axis === 0 ? by : 0),
    turn[1] + (axis === 1 ? by : 0),
    turn[2] + (axis === 2 ? by : 0),
  ]
}

function lerp(from: number, to: number, k: number): number {
  return from + (to - from) * k
}
