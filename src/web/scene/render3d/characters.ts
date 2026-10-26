import {
  type BufferGeometry,
  Group,
  Mesh,
  type MeshBasicMaterial,
  type MeshToonMaterial,
  type Object3D,
  Skeleton,
  SkinnedMesh,
} from 'three'

import type { InHand } from '@/web/scene/sim/actors/poses'
import type { ActorId, ActorView, Point } from '@/web/scene/types'
import { createPartKit } from '@/web/scene/render3d/bake'
import {
  type BuiltFigure,
  buildHuman,
  createHullMaterial,
  FIGURE_SCALE,
  JOINTS,
  type Joint,
  STAND_H,
} from '@/web/scene/render3d/figure'
import { type HeldState, releaseHeld, syncHeld } from '@/web/scene/render3d/held'
import { type JointTargets, targetsOf, yawOf } from '@/web/scene/render3d/joints'
import { buildMascot } from '@/web/scene/render3d/mascot'
import { toUnits, UNIT_PX } from '@/web/scene/render3d/space'
import {
  inHandOf,
  isActorWalking,
  isBlinking,
  isBreathDown,
  isOnFloor,
  poseFrameAt,
} from '@/web/scene/sim/actors/poses'
import { OUTLINE, WORK_RIM } from '@/web/scene/sprites/palette'
import { lookOf } from '@/web/scene/sprites/parts'
import { seedOf } from '@/web/scene/world/rng'
import { LOUNGE_BENCH, SEATS, type Seat, SOFA_SEATS, TEAM_SEATS } from '@/web/scene/world/seats'

/** Everyone the 3D office has built, by person; a person off the floor keeps their rig hidden. */
export interface Cast {
  readonly root: Group
  readonly rigs: Map<ActorId, Rig>
  readonly kit: ReturnType<typeof createPartKit>
  readonly toon: MeshToonMaterial
}

/** What the people are drawn against this frame. */
interface CastFrame {
  readonly actors: readonly ActorView[]
  readonly floor: ActorView['floor']
  readonly alpha: number
  readonly now: number
  readonly dtMs: number
  /** CSS px per world px, for the outline's width. */
  readonly scale: number
  readonly isMotionOn: boolean
  readonly isReduced: boolean
}

/** Where a person stands this frame, and how high their head is, for the dots and shadows. */
export interface Standing {
  readonly actor: ActorView
  readonly at: Point
  readonly top: number
}

interface Rig {
  readonly look: string
  readonly isMascot: boolean
  readonly root: Group
  readonly figure: BuiltFigure & { readonly eyes?: Group }
  readonly hull: MeshBasicMaterial
  readonly width: { value: number }
  readonly lid?: Mesh
  readonly owned: { dispose(): void }[]
  held: HeldState
  sit: number
  yaw: number
  walkedAt: number
}

// Outline about this many screen px, clamped in rig units; a working person's is thicker.
const OUTLINE_PX = 1.6
const OUTLINE_WORLD_MIN = 0.014
const OUTLINE_WORLD_MAX = 0.042
const WORK_OUTLINE = 1.8
// A rig that just walked keeps easing at once for the turn and the sit-down.
const FULL_TAIL_MS = 250
const JOINT_EASE_MS = 70
const SIT_EASE_MS = 110
const YAW_EASE_MS = 140
const WALK_YAW_EASE_MS = 60
const SETTLED = 0.006
const SEAT_REACH_PX = 3
const SEAT_H = 0.62
const MASCOT_SEAT_RISE = 0.36
// The mascot's egg is its torso and head, and its feet do not bend: only its arms move.
const MASCOT_JOINTS: readonly Joint[] = Object.freeze(['uaL', 'uaR', 'faL', 'faR'])
const BREATH_DIP = 0.025
const STAND_TOP_PX = 33
const SEATED_DROP_PX = 4
const GAIT_MS = 500
const SEATS_ALL: readonly Seat[] = Object.freeze([
  ...SEATS.meet,
  ...SEATS.lib,
  ...SEATS.assist,
  ...TEAM_SEATS,
  ...LOUNGE_BENCH,
  ...SOFA_SEATS.office,
  ...SOFA_SEATS.team,
])

export function createCast(toon: MeshToonMaterial): Cast {
  return { root: new Group(), rigs: new Map(), kit: createPartKit(), toon }
}

/** Places, poses and outlines everyone on the floor; `isSettling` while a pose still eases. */
export function syncCast(
  cast: Cast,
  frame: CastFrame
): { readonly standing: Standing[]; readonly isSettling: boolean } {
  const here = frame.actors.filter((actor) => isOnFloor(actor, frame.floor))
  const ids = new Set(here.map((actor) => actor.id))
  const standing: Standing[] = []
  let isSettling = false

  for (const [id, rig] of cast.rigs) {
    rig.root.visible = ids.has(id)

    if (!frame.actors.some((actor) => actor.id === id)) {
      dropRig(cast, id)
    }
  }

  for (const actor of here) {
    const rig = resolveRig(cast, actor)
    const at = placeOf(actor, frame.alpha)

    isSettling = poseRig(rig, { cast, actor, frame, at }) || isSettling
    standing.push({ actor, at, top: STAND_TOP_PX - SEATED_DROP_PX * rig.sit })
  }

  return { standing, isSettling }
}

export function disposeCast(cast: Cast): void {
  for (const id of [...cast.rigs.keys()]) {
    dropRig(cast, id)
  }

  cast.kit.dispose()
}

function placeOf(actor: ActorView, alpha: number): Point {
  return {
    x: actor.prev.x + (actor.at.x - actor.prev.x) * alpha,
    y: actor.prev.y + (actor.at.y - actor.prev.y) * alpha,
  }
}

// A rig is rebuilt only when the person's look changes.
function resolveRig(cast: Cast, actor: ActorView): Rig {
  const look = lookOf(actor.id, actor.role, actor.look)
  const key = JSON.stringify(look)
  const held = cast.rigs.get(actor.id)

  if (held?.look === key) {
    return held
  }

  dropRig(cast, actor.id)

  const rig = buildRig(cast, look, key)

  rig.yaw = yawOf({ facing: actor.facing, step: [0, 0], isFront: false })
  cast.rigs.set(actor.id, rig)
  cast.root.add(rig.root)

  return rig
}

function buildRig(cast: Cast, look: ReturnType<typeof lookOf>, key: string): Rig {
  const root = new Group()
  const pivot = new Group()
  const width = { value: OUTLINE_WORLD_MIN }
  const hull = createHullMaterial(width)
  const owned: { dispose(): void }[] = [hull]

  pivot.scale.setScalar(FIGURE_SCALE)
  root.add(pivot)

  const figure = look.isMascot ? buildMascot(cast.kit, pivot) : buildHuman(look, cast.kit, pivot)
  const lid = figure.lids === undefined ? undefined : new Mesh(figure.lids, cast.toon)

  if (figure.body !== undefined) {
    skinBody({ figure, geometry: figure.body, pivot, owned }, { toon: cast.toon, hull })
  }

  for (const part of figure.parts ?? []) {
    part.parent.add(new Mesh(part.geometry, cast.toon), new Mesh(part.geometry, hull))
    owned.push(part.geometry)
  }

  if (lid !== undefined) {
    lid.visible = false
    figure.joints.head.add(lid)
    owned.push(lid.geometry)
  }

  return {
    look: key,
    isMascot: look.isMascot,
    root,
    figure,
    hull,
    width,
    ...(lid === undefined ? {} : { lid }),
    owned,
    held: { key: '' },
    sit: 0,
    yaw: 0,
    walkedAt: Number.NEGATIVE_INFINITY,
  }
}

// One skinned body and its inverted hull share the geometry and the skeleton.
function skinBody(
  built: {
    readonly figure: BuiltFigure
    readonly geometry: BufferGeometry
    readonly pivot: Group
    readonly owned: { dispose(): void }[]
  },
  materials: { readonly toon: MeshToonMaterial; readonly hull: MeshBasicMaterial }
): void {
  const { figure, geometry, pivot, owned } = built
  const skeleton = new Skeleton([...figure.bones])
  const body = new SkinnedMesh(geometry, materials.toon)
  const hull = new SkinnedMesh(geometry, materials.hull)

  body.frustumCulled = false
  hull.frustumCulled = false
  pivot.add(body, hull)
  body.bind(skeleton)
  hull.bind(skeleton, body.bindMatrix)
  owned.push(geometry, skeleton)
}

function dropRig(cast: Cast, id: ActorId): void {
  const rig = cast.rigs.get(id)

  if (rig === undefined) {
    return
  }

  cast.root.remove(rig.root)
  releaseHeld(rig.held, undefined)

  for (const one of rig.owned) {
    one.dispose()
  }

  cast.rigs.delete(id)
}

interface PoseJob {
  readonly cast: Cast
  readonly actor: ActorView
  readonly frame: CastFrame
  readonly at: Point
}

// True while the rig still eases toward its pose.
function poseRig(rig: Rig, job: PoseJob): boolean {
  const { actor, frame, at, cast } = job
  const read = readPose(rig, job)

  if (read.isWalking) {
    rig.walkedAt = frame.now
  }

  const eased = easeRig(rig, {
    targets: read.targets,
    frame,
    wantSit: read.isSeated ? 1 : 0,
    wantYaw: read.wantYaw,
    isWalking: read.isWalking,
  })
  const isBreathing = read.isAnimated && !read.isWalking && actor.working

  const held = syncHeld(rig.held, {
    inHand: read.inHand,
    seed: read.seed,
    hand: rig.figure.joints.faR,
    arm: rig.figure.joints.uaR,
    cast,
  })
  const isHeldNew = held !== rig.held

  rig.held = held
  rig.root.position.set(
    toUnits(at.x),
    toUnits(read.targets.hop * UNIT_PX * FIGURE_SCALE),
    toUnits(at.y)
  )
  rig.root.rotation.y = rig.yaw
  placeBody(rig, isBreathing && isBreathDown(read.seed, frame.now))
  showEyes(rig, read.targets.isShut || (frame.isMotionOn && isBlinking(read.seed, frame.now)))
  outline(rig, { scale: frame.scale, isWorking: actor.working })

  return eased || isHeldNew || frame.now - rig.walkedAt < FULL_TAIL_MS
}

interface ReadPose {
  readonly seed: number
  readonly isWalking: boolean
  readonly isAnimated: boolean
  readonly isSeated: boolean
  readonly inHand: InHand
  readonly targets: JointTargets
  readonly wantYaw: number
}

// The pose frame the person shows now, read as joint targets: seated when standing on a seat, a
// phone read in both hands unless the pose holds one, a desk sitter turned to the desk.
function readPose(rig: Rig, job: PoseJob): ReadPose {
  const { actor, frame, at } = job
  const seed = seedOf(actor.id)
  const isWalking = isActorWalking(actor)
  const isAnimated = frame.isMotionOn && !frame.isReduced
  const shown = poseFrameAt(actor.pose, {
    seed,
    sinceMs: actor.poseSince,
    nowMs: isAnimated ? frame.now : actor.poseSince,
  })
  const inHand = inHandOf(actor, shown)
  const pose =
    inHand.phone === undefined || inHand.phone === shown.phone
      ? shown
      : { ...shown, phone: inHand.phone }
  const seat = isWalking
    ? undefined
    : SEATS_ALL.find((one) => Math.hypot(one.at.x - at.x, one.at.y - at.y) <= SEAT_REACH_PX)
  const swing = isWalking && !frame.isReduced ? Math.sin((frame.now / GAIT_MS) * Math.PI * 2) : 0
  const step: readonly [number, number] = [actor.at.x - actor.prev.x, actor.at.y - actor.prev.y]
  const facing = yawOf({ facing: actor.facing, step, isFront: pose.isFront === true })

  return {
    seed,
    isWalking,
    isAnimated,
    isSeated: seat !== undefined,
    inHand,
    targets: targetsOf(pose, {
      swing,
      sit: rig.sit,
      side: seed % 2 === 0 ? 1 : -1,
      isHolding: inHand.hold !== undefined && inHand.hold !== 'bag',
      isWalking,
    }),
    wantYaw: seat?.desk === true ? Math.PI : facing,
  }
}

function easeRig(
  rig: Rig,
  spec: {
    readonly targets: JointTargets
    readonly frame: CastFrame
    readonly wantSit: number
    readonly wantYaw: number
    readonly isWalking: boolean
  }
): boolean {
  const { frame } = spec
  const isSnap = frame.isReduced
  const k = isSnap ? 1 : 1 - Math.exp(-frame.dtMs / JOINT_EASE_MS)
  const sitK = isSnap ? 1 : 1 - Math.exp(-frame.dtMs / SIT_EASE_MS)
  const yawK = isSnap
    ? 1
    : 1 - Math.exp(-frame.dtMs / (spec.isWalking ? WALK_YAW_EASE_MS : YAW_EASE_MS))
  const yawGap = angleGap(rig.yaw, spec.wantYaw)
  let isMoving = Math.abs(spec.wantSit - rig.sit) > SETTLED || Math.abs(yawGap) > SETTLED

  rig.sit += (spec.wantSit - rig.sit) * sitK
  rig.yaw += yawGap * yawK

  for (const joint of rig.isMascot ? MASCOT_JOINTS : JOINTS) {
    isMoving = easeJoint(rig.figure.joints[joint], spec.targets.joints[joint], k) || isMoving
  }

  return isMoving
}

// A person's hips drop to the seat and their chest dips with a breath; the mascot's egg rises
// onto the chair instead and does not breathe.
function placeBody(rig: Rig, isBreathOut: boolean): void {
  if (rig.isMascot) {
    rig.figure.hips.position.y = MASCOT_SEAT_RISE * rig.sit
    return
  }

  rig.figure.hips.position.y = STAND_H + (SEAT_H - STAND_H) * rig.sit
  rig.figure.joints.torso.position.y = isBreathOut ? -BREATH_DIP : 0
}

function easeJoint(joint: Object3D, target: readonly [number, number, number], k: number): boolean {
  const r = joint.rotation
  const gap = Math.abs(target[0] - r.x) + Math.abs(target[1] - r.y) + Math.abs(target[2] - r.z)

  r.set(r.x + (target[0] - r.x) * k, r.y + (target[1] - r.y) * k, r.z + (target[2] - r.z) * k)

  return gap > SETTLED
}

function angleGap(from: number, to: number): number {
  const full = Math.PI * 2
  const gap = ((((to - from) % full) + full * 1.5) % full) - Math.PI

  return gap
}

function showEyes(rig: Rig, isShut: boolean): void {
  if (rig.lid !== undefined) {
    rig.lid.visible = isShut
  }

  rig.figure.eyes?.scale.setY(isShut ? 0.15 : 1)
}

function outline(rig: Rig, spec: { readonly scale: number; readonly isWorking: boolean }): void {
  const edge = Math.min(
    OUTLINE_WORLD_MAX,
    Math.max(OUTLINE_WORLD_MIN, OUTLINE_PX / (spec.scale * UNIT_PX * FIGURE_SCALE))
  )

  rig.width.value = spec.isWorking ? edge * WORK_OUTLINE : edge
  rig.hull.color.set(spec.isWorking ? WORK_RIM : OUTLINE)
}
