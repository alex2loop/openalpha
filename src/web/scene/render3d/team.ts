import type { Group } from 'three'

import type { EffectFrame } from '@/web/scene/render3d/effects'
import type { Materials } from '@/web/scene/render3d/lights'
import type { DeskFocus, ThreadView } from '@/web/scene/types'
import {
  beginPool,
  createPool,
  endPool,
  type Pool,
  placeInstance,
  type Shapes,
} from '@/web/scene/render3d/instancing'
import { FOCUS_TONES, OUTLINE, PROP_TONES } from '@/web/scene/sprites/palette'
import { DESK_SHIFT_PX, DESK_SLOTS } from '@/web/scene/world/floors'

/** The team floor's own pieces: the dotted threads and scored bursts, and each desk's prop. */
export interface TeamPieces {
  readonly sparks: Pool
  readonly focus: Pool
}

const THREAD_OFF = '#B7C3DD'
const MAX_SPARKS = 240
const MAX_FOCUS = 12
const THREAD = Object.freeze({ step: 6, dot: 2.2, rise: 22, arc: 8, tick: 120, phases: 3 })
const BURST = Object.freeze({ tick: 140, phases: 4, y: 20, size: 3 })
const BURST_SPARKS: readonly (readonly [number, number])[] = Object.freeze([
  [-12, 0],
  [12, 0],
  [0, -7],
  [-8, -5],
  [8, -5],
  [-8, 5],
  [8, 5],
  [0, 7],
])
const FOCUS_AT = Object.freeze({ dx: 28, dz: DESK_SHIFT_PX - 6, y: 14 })
const FOCUS_LOOKS: Readonly<Record<DeskFocus, readonly [string, number]>> = Object.freeze({
  safe: [FOCUS_TONES.safe, 8],
  candles: [FOCUS_TONES.candles, 8],
  gold: [FOCUS_TONES.gold, 4],
  piggy: [FOCUS_TONES.piggy, 6],
})

export function createTeamPieces(shapes: Shapes, materials: Materials, root: Group): TeamPieces {
  const pieces = {
    sparks: createPool(shapes.box, materials.unlitI, { cap: MAX_SPARKS }),
    focus: createPool(shapes.box, materials.litI, { cap: MAX_FOCUS }),
  }

  root.add(pieces.sparks.mesh, pieces.focus.mesh)

  return pieces
}

/** Rewrites what changed; `isMoving` while a thread or a burst plays. */
export function syncTeamPieces(
  pieces: TeamPieces,
  frame: EffectFrame
): { readonly isChanged: boolean; readonly isMoving: boolean } {
  const isSparked = syncSparks(pieces.sparks, frame)
  const isFocused = syncFocus(pieces.focus, frame)
  const { floor, team } = frame.sim
  const isPlaying = floor === 'team' && (team.threads.length > 0 || team.bursts.length > 0)

  return { isChanged: isSparked || isFocused, isMoving: !frame.isReduced && isPlaying }
}

export function disposeTeamPieces(pieces: TeamPieces): void {
  pieces.sparks.mesh.dispose()
  pieces.focus.mesh.dispose()
}

// The dotted threads from a parent's desk to each open child, and each scored call's burst.
function syncSparks(pool: Pool, frame: EffectFrame): boolean {
  const { team, floor } = frame.sim
  const isTeam = floor === 'team'
  const phase = frame.isReduced ? 0 : Math.floor(frame.now / THREAD.tick) % THREAD.phases
  const step = frame.isReduced
    ? BURST.phases - 1
    : Math.floor(frame.now / BURST.tick) % BURST.phases

  if (
    !beginPool(pool, isTeam ? `${team.threads.length}|${team.bursts.length}|${phase}|${step}` : '')
  ) {
    return false
  }

  for (const thread of isTeam ? team.threads : []) {
    threadDots(pool, thread, phase)
  }

  for (const burst of isTeam ? team.bursts : []) {
    burstAt(pool, { at: burst.at, tone: burst.tone, spread: 1 + step / (BURST.phases - 1) })
  }

  endPool(pool)

  return true
}

function threadDots(pool: Pool, thread: ThreadView, phase: number): void {
  const count = Math.max(
    1,
    Math.round(Math.hypot(thread.to.x - thread.from.x, thread.to.y - thread.from.y) / THREAD.step)
  )

  for (let i = 0; i <= count; i++) {
    const k = i / count

    placeInstance(pool, {
      x: thread.from.x + (thread.to.x - thread.from.x) * k,
      y: THREAD.rise + Math.sin(k * Math.PI) * THREAD.arc,
      z: thread.from.y + (thread.to.y - thread.from.y) * k,
      size: [THREAD.dot, THREAD.dot, THREAD.dot],
      color: (i + phase) % THREAD.phases === 0 ? PROP_TONES.threadOn : THREAD_OFF,
    })
  }
}

function burstAt(
  pool: Pool,
  spec: {
    readonly at: { readonly x: number; readonly y: number }
    readonly tone: 'target' | 'stop'
    readonly spread: number
  }
): void {
  const { at, spread } = spec

  if (spec.tone === 'stop') {
    for (const [i, tone] of PROP_TONES.cloud.entries()) {
      placeInstance(pool, {
        x: at.x,
        y: BURST.y + 6 + i * 6,
        z: at.y,
        size: [16 - i * 6, 5 - i, 8],
        color: tone,
      })
    }

    return
  }

  for (const [dx, dz] of BURST_SPARKS) {
    placeInstance(pool, {
      x: at.x + dx * spread,
      y: BURST.y - dz * 0.4 * spread,
      z: at.y + dz * spread,
      size: [BURST.size, BURST.size, BURST.size],
      color: PROP_TONES.burst,
    })
  }
}

// The prop an own agent's desk carries, read off its focus.
function syncFocus(pool: Pool, frame: EffectFrame): boolean {
  const desks = frame.sim.floor === 'team' ? frame.sim.team.desks : []

  if (!beginPool(pool, desks.map((desk) => `${desk.slot}${desk.focus ?? ''}`).join())) {
    return false
  }

  for (const desk of desks) {
    const slot = DESK_SLOTS[desk.slot]
    const look = desk.focus === undefined ? undefined : FOCUS_LOOKS[desk.focus]

    if (slot !== undefined && look !== undefined) {
      const [tone, tall] = look

      placeInstance(pool, {
        x: slot.x + FOCUS_AT.dx,
        y: FOCUS_AT.y + tall / 2,
        z: slot.y + FOCUS_AT.dz,
        size: [9, tall, 7],
        color: tone,
      })
      placeInstance(pool, {
        x: slot.x + FOCUS_AT.dx,
        y: FOCUS_AT.y + 0.3,
        z: slot.y + FOCUS_AT.dz,
        size: [10, 0.6, 8],
        color: OUTLINE,
      })
    }
  }

  endPool(pool)

  return true
}
