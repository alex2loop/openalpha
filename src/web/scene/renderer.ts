import type { Point, ScreenPoint, SimView } from '@/web/scene/types'

const RENDER_WINDOW_MS = 1_000
// Above any display's refresh rate, so the window never drops a render it should count.
const MAX_RENDER_SAMPLES = 240

export interface RendererStats {
  /** Which renderer measured these: the frame budget is the 2D one's alone. */
  readonly view: '2d' | '3d'
  readonly frameMs: number
  readonly rendersPerSecond: number
  readonly drawCalls?: number
}

/** What the composer drives, whichever renderer is mounted. */
export interface SceneRenderer {
  mount(host: HTMLElement): void
  unmount(): void
  /** Draws one frame; true while something on it still animates. */
  draw(view: SimView, now: number): boolean
  toScreen(p: Point): ScreenPoint
  toWorld(s: ScreenPoint): Point
  stats(): RendererStats
}

/** The composer's one renderer: a fixed face the loop and overlays keep while the drawing behind
 *  it swaps between 2D and 3D. */
export interface RendererHost extends SceneRenderer {
  /** Unmounts the renderer shown, then mounts `next` where it was; a throwing mount leaves `next`
   *  in place for the caller to swap away from. */
  swap(next: SceneRenderer): void
}

/** Counts a renderer's renders over the last `RENDER_WINDOW_MS`, for its stats. */
interface RenderRate {
  note(now: number): void
  perSecond(now: number): number
}

export function createRenderRate(): RenderRate {
  const times: number[] = []

  return {
    note(now) {
      times.push(now)

      if (times.length > MAX_RENDER_SAMPLES) {
        times.shift()
      }
    },
    perSecond: (now) => times.filter((at) => now - at < RENDER_WINDOW_MS).length,
  }
}

/** Frees a canvas's pixels now instead of at collection. */
export function zeroCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0
  canvas.height = 0
}

export function createRendererHost(first: SceneRenderer): RendererHost {
  let shown = first
  let host: HTMLElement | undefined

  return {
    mount(element) {
      host = element
      shown.mount(element)
    },
    unmount() {
      shown.unmount()
      host = undefined
    },
    draw: (view, now) => shown.draw(view, now),
    toScreen: (p) => shown.toScreen(p),
    toWorld: (s) => shown.toWorld(s),
    stats: () => shown.stats(),
    swap(next) {
      if (next === shown) {
        return
      }

      shown.unmount()
      shown = next

      if (host !== undefined) {
        next.mount(host)
      }
    },
  }
}
