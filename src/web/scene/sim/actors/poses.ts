import type { ActorView, FloorId, HeldItem, PoseId, SheetView } from '@/web/scene/types'
import { createRng, seedOf } from '@/web/scene/world/rng'

const GAIT_STEP_MS = 250
const TYPE_BEAT_MS = 110
const WAVE_BEAT_MS = 110
const HOP_BEAT_MS = 180
const NOD_BEAT_MS = 300
const TAP_BEAT_MS = 260
const STAMP_BEAT_MS = 280
const SCRATCH_BEAT_MS = 320
const SIP_BEAT_MS = 900
// Each person plays a moving pose this much faster or slower than the table, at most.
const POSE_SPEED_SPREAD = 0.1
const BLINK_MS = 130
const BLINK_GAP_MIN_MS = 3_000
const BLINK_GAP_MAX_MS = 6_000
// One breath: up for half, down for half, flipped in one step.
const BREATH_MS = 1_100
const AMBIENT_BOUT_MS = 6_000
const AMBIENT_REST_MS = Object.freeze({ min: 20_000, max: 40_000 })
// One bout per slot, its start drawn inside the jitter, so the rest between two bouts falls
// inside `AMBIENT_REST_MS`.
const AMBIENT_JITTER_MS = (AMBIENT_REST_MS.max - AMBIENT_REST_MS.min) / 2
const AMBIENT_SLOT_MS = AMBIENT_BOUT_MS + (AMBIENT_REST_MS.min + AMBIENT_REST_MS.max) / 2
const AMBIENT_POOL = 'ambient'
// A fidget at the seat: a glance aside, a look down, hands behind the head.
const FIDGET_POSES: readonly [PoseId, ...PoseId[]] = ['glance', 'look-down', 'lean-back']
const POSE_POOL = 'pose'

/** Where the arms are; `down` hangs them, swinging with the gait. */
export type Arms =
  | 'down'
  | 'type'
  | 'hand'
  | 'cheer'
  | 'relax'
  | 'cross'
  | 'nap'
  | 'shrug'
  | 'scratch'
  | 'sip'

/** Something in the right hand besides a phone or a sheet. */
export type HeldKind = 'cup' | 'bag' | 'box' | 'item'

/** What the hands show: a phone, a held kind and a sheet may show together. */
export interface InHand {
  readonly phone?: 'call' | 'read'
  readonly hold?: HeldKind
  readonly sheet?: NonNullable<SheetView['action']> | 'blank'
}

/** One picture of a pose, what the sprite builders draw on top of the look. */
export interface PoseFrame {
  readonly arms?: Arms
  /** Which beat of a two-beat motion: the key hand while typing, the scratching hand's height. */
  readonly beat?: 0 | 1
  /** The step of a walk: 1 lifts the left foot, 3 the right. */
  readonly gait?: 0 | 1 | 2 | 3
  readonly isAside?: boolean
  readonly isDown?: boolean
  readonly isShut?: boolean
  readonly isYawn?: boolean
  readonly isHop?: boolean
  readonly isWave?: boolean
  /** Turns to face the room even when walking away. */
  readonly isFront?: boolean
  readonly headDrop?: number
  readonly phone?: 'call' | 'read'
  readonly hold?: HeldKind
}

/** A pose: with `frameMs` its frames play in turn; without, they are variants and each person
 *  holds the one its seed picks. */
interface PoseDef {
  readonly frames: readonly [PoseFrame, ...PoseFrame[]]
  readonly frameMs?: number
}

interface PoseClock {
  readonly seed: number
  readonly sinceMs: number
  readonly nowMs: number
}

// What each carried thing is held as; a phone is held its own way.
const HELD_OF: Readonly<Record<HeldItem, HeldKind | undefined>> = Object.freeze({
  card: 'item',
  calculator: 'item',
  pen: 'item',
  phone: undefined,
  headset: 'item',
  wallet: 'item',
  box: 'box',
  cup: 'cup',
  bag: 'bag',
})

/** The whole pose vocabulary; `cheer` is the mascot's alone. */
const POSES: Readonly<Record<PoseId, PoseDef>> = Object.freeze({
  idle: { frames: [{}, { isAside: true }] },
  walk: { frames: [{ gait: 1 }, { gait: 0 }, { gait: 3 }, { gait: 2 }], frameMs: GAIT_STEP_MS },
  sit: { frames: [{}, { isDown: true }] },
  type: {
    frames: [
      { arms: 'type', beat: 0 },
      { arms: 'type', beat: 1 },
    ],
    frameMs: TYPE_BEAT_MS,
  },
  hand: { frames: [{ arms: 'hand' }, { arms: 'hand', isAside: true }] },
  carry: { frames: [{}, { isDown: true }] },
  scratch: {
    frames: [
      { arms: 'scratch', beat: 0, isAside: true },
      { arms: 'scratch', beat: 1, isAside: true },
    ],
    frameMs: SCRATCH_BEAT_MS,
  },
  'phone-call': {
    frames: [
      { arms: 'hand', phone: 'call' },
      { arms: 'hand', phone: 'call', isAside: true },
    ],
  },
  'phone-read': { frames: [{ phone: 'read', isDown: true }, { phone: 'read' }] },
  reach: { frames: [{ arms: 'hand' }, { arms: 'hand', isAside: true }] },
  stamp: {
    frames: [
      { arms: 'type', beat: 0 },
      { arms: 'type', beat: 1, isDown: true },
    ],
    frameMs: STAMP_BEAT_MS,
  },
  nod: {
    frames: [{ isFront: true }, { isFront: true, isDown: true, headDrop: 1 }],
    frameMs: NOD_BEAT_MS,
  },
  shrug: { frames: [{ arms: 'shrug' }, { arms: 'shrug', isAside: true }] },
  cheer: { frames: [{ arms: 'cheer' }, { arms: 'cheer', isHop: true }], frameMs: HOP_BEAT_MS },
  'lean-back': { frames: [{ arms: 'relax' }, { arms: 'relax', isAside: true }] },
  glance: { frames: [{ isAside: true }, { isAside: true, isDown: true }] },
  sip: { frames: [{ arms: 'sip', hold: 'cup' }, { hold: 'cup' }], frameMs: SIP_BEAT_MS },
  'foot-tap': { frames: [{ gait: 0 }, { gait: 3 }], frameMs: TAP_BEAT_MS },
  nap: {
    frames: [
      { arms: 'nap', isShut: true, headDrop: 6 },
      { arms: 'nap', isShut: true, headDrop: 5 },
    ],
  },
  yawn: {
    frames: [
      { arms: 'cheer', isYawn: true, isShut: true },
      { arms: 'relax', isYawn: true, isShut: true },
    ],
  },
  'hands-up': { frames: [{ arms: 'cheer' }, { arms: 'cheer', isAside: true }] },
  point: { frames: [{ arms: 'hand' }, { arms: 'hand', isAside: true }] },
  watch: { frames: [{ arms: 'cross', isDown: true }, { arms: 'cross' }] },
  chat: {
    frames: [
      { arms: 'cross', isAside: true, isFront: true },
      { arms: 'cross', isFront: true },
    ],
  },
  wave: {
    frames: [
      { arms: 'hand', isFront: true },
      { arms: 'hand', isWave: true, isFront: true },
    ],
    frameMs: WAVE_BEAT_MS,
  },
  look: {
    frames: [
      { isAside: true, isFront: true },
      { isAside: true, isFront: true, isDown: true },
    ],
  },
  'busy-glance': { frames: [{ isAside: true }, { isAside: true, isDown: true }] },
  'look-down': { frames: [{ isDown: true }] },
  'sit-up': { frames: [{}] },
} satisfies Record<PoseId, PoseDef>)

/** Whether a floor's people blink and breathe now: always while one works, walks or plays a
 *  moving pose, otherwise only inside an ambient bout, so a quiet floor asks for no frame. */
export function isCharacterMotionOn(
  actors: readonly ActorView[],
  at: { readonly floor: FloorId; readonly now: number }
): boolean {
  const here = actors.filter((actor) => isOnFloor(actor, at.floor))

  if (here.length === 0) {
    return false
  }

  const isBusy = here.some(
    (actor) => actor.working || isActorWalking(actor) || isPoseMoving(actor.pose)
  )

  return isBusy || isAmbientBout(at.floor, at.now)
}

/** The person stands on `floor` now; someone out on an errand or gone home stands on none. */
export function isOnFloor(actor: ActorView, floor: FloorId): boolean {
  return actor.floor === floor && actor.errand?.isOut !== true && actor.isAway !== true
}

/** The person moved between the last two sim steps. */
export function isActorWalking(actor: ActorView): boolean {
  return actor.prev.x !== actor.at.x || actor.prev.y !== actor.at.y
}

/** What a person's hands show this frame, in both renderers: the pose's phone or held kind, else
 *  what they carry (a phone is read in both hands unless the pose holds something or has its own
 *  phone), and a sheet beside either, `blank` until it is stamped. */
export function inHandOf(actor: ActorView, pose: PoseFrame): InHand {
  const sheet: Pick<InHand, 'sheet'> =
    actor.sheet === undefined ? {} : { sheet: actor.sheet.action ?? 'blank' }
  const item = pose.hold === undefined ? actor.item : undefined
  const phone = pose.phone ?? (item === 'phone' ? 'read' : undefined)
  const hold = pose.hold ?? (item === undefined ? undefined : HELD_OF[item])

  return {
    ...sheet,
    ...(phone === undefined ? {} : { phone }),
    ...(hold === undefined ? {} : { hold }),
  }
}

/** The fidget `seed` picks. */
export function fidgetPoseOf(seed: number): PoseId {
  return createRng(seed).pick(FIDGET_POSES)
}

/** Whether the pose moves on its own, so it asks for frames while it shows. */
function isPoseMoving(pose: PoseId): boolean {
  return POSES[pose].frameMs !== undefined
}

/** The frame a person shows `clock.nowMs`: a moving pose plays at its own speed from its own
 *  offset, so no two people move in lockstep; a still one holds the person's variant. */
export function poseFrameAt(pose: PoseId, clock: PoseClock): PoseFrame {
  const { frames, frameMs } = POSES[pose]
  const rng = createRng(seedOf(POSE_POOL, pose, String(clock.seed)))

  if (frameMs === undefined) {
    return rng.pick(frames)
  }

  const speed = 1 + (rng.next() * 2 - 1) * POSE_SPEED_SPREAD
  const offsetMs = rng.next() * frameMs * frames.length
  const index = Math.floor(((clock.nowMs - clock.sinceMs) * speed + offsetMs) / frameMs)

  return frames[index % frames.length] ?? frames[0]
}

/** Eyes shut for one short moment every few seconds, each person on their own beat. */
export function isBlinking(seed: number, nowMs: number): boolean {
  const rng = createRng(seed)
  const gapMs = BLINK_GAP_MIN_MS + rng.next() * (BLINK_GAP_MAX_MS - BLINK_GAP_MIN_MS)

  return (nowMs + rng.next() * gapMs) % gapMs < BLINK_MS
}

/** The breathing bob's low half. */
export function isBreathDown(seed: number, nowMs: number): boolean {
  const offsetMs = createRng(seed).next() * BREATH_MS

  return Math.floor((nowMs + offsetMs) / (BREATH_MS / 2)) % 2 === 1
}

/** Whether a quiet floor's blink and breath (or a pet's or a fish's moves, by its own `pool`) run
 *  now: in bouts, with a rest between them. */
export function isAmbientBout(pool: string, nowMs: number): boolean {
  const bout = boutIn(pool, slotOf(nowMs))

  return nowMs >= bout.startMs && nowMs < bout.endMs
}

/** The next instant a bout of `pool` starts or ends. */
export function nextAmbientAt(pool: string, nowMs: number): number {
  const slot = slotOf(nowMs)
  const bout = boutIn(pool, slot)

  if (nowMs < bout.startMs) {
    return bout.startMs
  }

  return nowMs < bout.endMs ? bout.endMs : boutIn(pool, slot + 1).startMs
}

function boutIn(pool: string, slot: number): { startMs: number; endMs: number } {
  const jitter = createRng(seedOf(AMBIENT_POOL, pool, String(slot))).next()
  const startMs = slot * AMBIENT_SLOT_MS + jitter * AMBIENT_JITTER_MS

  return { startMs, endMs: startMs + AMBIENT_BOUT_MS }
}

function slotOf(nowMs: number): number {
  return Math.floor(nowMs / AMBIENT_SLOT_MS)
}
