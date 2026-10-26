import { computed, type ReadonlySignal, signal } from '@preact/signals'

import { breakpoint } from '@/web/state/breakpoints'
import { isChatOpen, setChatOpen } from '@/web/state/chat'

export type Pane = 'office' | 'info' | 'chat'

const shown = signal<Exclude<Pane, 'chat'>>('office')

/** The one pane on screen below the narrow width: the chat while it is open, else the office or
 *  the information it was left on, so closing the chat goes back to the pane before it. */
export const pane: ReadonlySignal<Pane> = computed(() => (isChatOpen.value ? 'chat' : shown.value))

/** Brings `next` forward. On a wide screen the chat stays docked beside whatever is chosen. */
export function showPane(next: Pane): void {
  if (next === 'chat') {
    setChatOpen(true)
    return
  }

  shown.value = next

  if (breakpoint.peek() !== 'wide') {
    setChatOpen(false)
  }
}
