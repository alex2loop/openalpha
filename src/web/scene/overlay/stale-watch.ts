import { effect, untracked } from '@preact/signals'

import type { createSimLoop } from '@/web/scene/sim/loop'
import { staleSince } from '@/web/state/live'

/** Holds the loop while the page's picture is stale and releases it once a fresh one lands; the
 *  returned stop ends the watch. */
export function watchStale(loop: Pick<ReturnType<typeof createSimLoop>, 'hold'>): () => void {
  return effect(() => {
    const isStale = staleSince.value !== undefined

    // The hold runs in this call: it must not subscribe the effect to what the loop reads.
    untracked(() => loop.hold(isStale))
  })
}
