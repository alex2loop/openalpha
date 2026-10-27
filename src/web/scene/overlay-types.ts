import type { ActorId, FloorId, Point, Rect } from '@/web/scene/types'

/** An "!" over a person: amber over the one who brought an approval, red over the clerk while a
 *  stop is breached. */
export interface SceneMark {
  readonly actor: ActorId
  readonly tone: 'need' | 'stop'
}

/** One line of a lit screen's terminal: the command that began the run, a step it finished, or the
 *  step it is on. `id` names the step, so a step that finishes keeps its line. */
export interface ScreenLine {
  readonly kind: 'command' | 'done' | 'step'
  readonly text: string
  readonly id: string
}

/** What a lit desk screen shows: the terminal of the page a scout reads, the closes of the ticker
 *  the analyst works on, or, for anyone else at work, the terminal of their own run. */
export type DeskScreenContent =
  | { readonly kind: 'host'; readonly host: string; readonly lines: readonly ScreenLine[] }
  | { readonly kind: 'run'; readonly title: string; readonly lines: readonly ScreenLine[] }
  | {
      readonly kind: 'line'
      readonly closes: readonly number[]
      readonly ticker: string
      readonly market: string
    }

/** A desk screen lit by its person's run: the screen in world px and what it shows. */
export interface DeskScreenView {
  readonly actor: ActorId
  readonly floor: FloorId
  readonly rect: Rect
  /** Where its person sits, which a renderer places a laptop by. */
  readonly seat: Point
  readonly content: DeskScreenContent
}
