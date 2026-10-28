import type { Rect } from '@/web/scene/types'
import { zeroCanvas } from '@/web/scene/renderer'
import { spriteBuildSkips } from '@/web/scene/sprites/sprite-cache'

/** One piece of a repaint, in world px. */
export type PaintStep = (g: CanvasRenderingContext2D) => void

/** What a repaint covers: the canvas it ends on and its scratch, the world rect, the px per world
 *  px, and its steps in draw order. */
interface RunSpec {
  readonly shown: HTMLCanvasElement
  readonly scratch: HTMLCanvasElement
  readonly rect: Rect
  readonly px: number
  readonly steps: readonly PaintStep[]
}

/** A repaint spread over frames: its steps paint onto a scratch canvas a few at a time, and the
 *  finished picture is copied onto the canvas that is shown, so that one is never half painted. */
export interface PaintRun {
  readonly shown: HTMLCanvasElement
  readonly scratch: HTMLCanvasElement
  readonly g: CanvasRenderingContext2D
  readonly steps: readonly PaintStep[]
  done: number
  /** A step left out a sprite it had no time to build, so the finished picture lacks it. */
  isPartial: boolean
}

/** Readies the scratch canvas for `spec`'s rect at its px; undefined when it gives no context. */
export function startRun(spec: RunSpec): PaintRun | undefined {
  const { scratch } = spec
  const g = scratch.getContext('2d')

  if (g === null) {
    return undefined
  }

  const { rect, px } = spec
  const width = Math.max(1, Math.ceil(rect.w * px))
  const height = Math.max(1, Math.ceil(rect.h * px))

  if (scratch.width === width && scratch.height === height) {
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, width, height)
  } else {
    scratch.width = width
    scratch.height = height
  }

  g.setTransform(px, 0, 0, px, -rect.x * px, -rect.y * px)

  return { shown: spec.shown, scratch, g, steps: spec.steps, done: 0, isPartial: false }
}

/** Paints steps until `until` (a `performance.now` time) passes. Once every step is done it
 *  copies the picture onto the shown canvas, frees the scratch one and returns true. A step that
 *  throws is tried again by the next call. */
export function stepRun(run: PaintRun, until: number): boolean {
  const skipsBefore = spriteBuildSkips()

  while (run.done < run.steps.length && performance.now() < until) {
    run.steps[run.done]?.(run.g)
    run.done++
  }

  run.isPartial ||= spriteBuildSkips() !== skipsBefore

  if (run.done < run.steps.length) {
    return false
  }

  commit(run)

  return true
}

/** Drops an unfinished repaint and frees its scratch canvas. */
export function cancelRun(run: PaintRun): void {
  zeroCanvas(run.scratch)
}

function commit({ shown, scratch }: PaintRun): void {
  const g = shown.getContext('2d')

  if (g !== null) {
    if (shown.width !== scratch.width || shown.height !== scratch.height) {
      shown.width = scratch.width
      shown.height = scratch.height
    }

    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalCompositeOperation = 'copy'
    g.drawImage(scratch, 0, 0)
    g.globalCompositeOperation = 'source-over'
  }

  zeroCanvas(scratch)
}
