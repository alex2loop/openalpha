import type { SceneRenderer } from '@/web/scene/renderer'
import type { ScreenPoint } from '@/web/scene/types'
import { ZOOM_STEP, zoomBy } from '@/web/scene/view'

// Two fingers pinch; a third is ignored.
const PINCH_TOUCHES = 2
const TOUCH = 'touch'

type TouchPair = readonly [ScreenPoint, ScreenPoint]

interface PinchDeps {
  readonly canvas: HTMLCanvasElement
  readonly renderer: SceneRenderer
}

/** Two fingers on the canvas zoom the shared camera about their midpoint, one step at a time. The
 *  canvas's input owns the listeners and hands each touch event here. */
export interface Pinch {
  /** A finger went down: true when it starts the pinch or is a finger past two, which no press
   *  takes. */
  down(event: PointerEvent): boolean
  /** A finger moved: true when the pinch took the move. */
  move(event: PointerEvent): boolean
  lift(pointerId: number): void
  clear(): void
}

export function createPinch(deps: PinchDeps): Pinch {
  // The fingers down, in page px, and while two are, their spread at the last zoom step.
  const points = new Map<number, ScreenPoint>()
  let spreadPx: number | undefined

  return {
    down: (event) => {
      if (event.pointerType !== TOUCH) {
        return false
      }

      if (points.size >= PINCH_TOUCHES) {
        return true
      }

      points.set(event.pointerId, { x: event.clientX, y: event.clientY })

      const pair = pairOf(points)

      spreadPx = pair === undefined ? undefined : spreadOf(pair)
      return pair !== undefined
    },
    move: (event) => {
      if (!points.has(event.pointerId)) {
        return false
      }

      points.set(event.pointerId, { x: event.clientX, y: event.clientY })

      const pair = pairOf(points)

      if (pair === undefined || spreadPx === undefined) {
        return false
      }

      spreadPx = zoomOnSpread(deps, pair, spreadPx)
      return true
    },
    lift: (pointerId) => {
      points.delete(pointerId)

      if (points.size < PINCH_TOUCHES) {
        spreadPx = undefined
      }
    },
    clear: () => {
      points.clear()
      spreadPx = undefined
    },
  }
}

// Each time the fingers spread or close by one zoom step, the camera zooms one step about them;
// the spread that step was taken at is the next one's base.
function zoomOnSpread(deps: PinchDeps, pair: TouchPair, basePx: number): number {
  const spread = spreadOf(pair)
  const steps = pinchStepsOf(spread / basePx)

  if (steps === 0) {
    return basePx
  }

  const box = deps.canvas.getBoundingClientRect()
  const [a, b] = pair

  zoomBy(
    steps,
    deps.renderer.toWorld({ x: (a.x + b.x) / 2 - box.left, y: (a.y + b.y) / 2 - box.top })
  )
  return spread
}

function pinchStepsOf(ratio: number): number {
  if (ratio >= ZOOM_STEP) {
    return 1
  }

  return ratio <= 1 / ZOOM_STEP ? -1 : 0
}

function pairOf(points: ReadonlyMap<number, ScreenPoint>): TouchPair | undefined {
  const [a, b] = [...points.values()]

  return a === undefined || b === undefined ? undefined : [a, b]
}

function spreadOf([a, b]: TouchPair): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
