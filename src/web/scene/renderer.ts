import type { Point, ScreenPoint, SimView } from '@/web/scene/types'

export interface RendererStats {
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
