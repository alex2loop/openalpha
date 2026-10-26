import type { ActorId, FloorId, Point, Rect } from '@/web/scene/types'

/** An "!" over a person: amber over the one who brought an approval, red over the clerk while a
 *  stop is breached. */
export interface SceneMark {
  readonly actor: ActorId
  readonly tone: 'need' | 'stop'
}

/** What a lit desk screen shows: the host a scout's page read names, or the closes of the ticker
 *  the analyst works on. */
export type DeskScreenContent =
  | { readonly kind: 'host'; readonly host: string }
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
