import { effect } from '@preact/signals'

import type { createSimLoop } from '@/web/scene/sim/loop'
import { staleSince } from '@/web/state/live'

/** Holds the loop while the page's picture is stale and releases it once a fresh one lands; the
 *  returned stop ends the watch. */
export function watchStale(loop: Pick<ReturnType<typeof createSimLoop>, 'hold'>): () => void {
  return effect(() => loop.hold(staleSince.value !== undefined))
}
