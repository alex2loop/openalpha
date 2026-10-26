import type { LifeState } from '@/web/scene/sim/life/state'
import type { FloorId, Rect } from '@/web/scene/types'
import { GROUND_FLOOR } from '@/web/scene/world/floors'

/** What stands in the way for a while on the office floor: the dessert cart, the wet-floor sign. */
export type BlockKey = 'cart' | 'sign'

/** The floor the cart rolls on and the cleaner mops. */
export const BLOCK_FLOOR: FloorId = GROUND_FLOOR

/** Puts `rect` down for `key`, or lifts it; walks start round everything still down. */
export function setBlock(state: LifeState, key: BlockKey, rect: Rect | undefined): void {
  if (rect === undefined) {
    state.blocks.delete(key)
  } else {
    state.blocks.set(key, rect)
  }

  state.director.setObstacles(BLOCK_FLOOR, [...state.blocks.values()])
}
