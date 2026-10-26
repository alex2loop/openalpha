import { computed, type ReadonlySignal, signal } from '@preact/signals'

import { breakpoint } from '@/web/state/breakpoints'
import { isChatOpen, setChatOpen } from '@/web/state/chat'

export type Pane = 'office' | 'info' | 'chat'

/** The query naming the one chat a tab of its own shows: `?chat=<sessionId>`. */
export const CHAT_TAB_PARAM = 'chat'

const shown = signal<Exclude<Pane, 'chat'>>('office')
const chatOnly = signal(false)

/** True on a tab opened for one chat: the chat pane alone, always open. */
export const isChatOnly: ReadonlySignal<boolean> = chatOnly

/** The one pane on screen below the narrow width: the chat while it is open, else the office or
 *  the information it was left on, so closing the chat goes back to the pane before it. */
export const pane: ReadonlySignal<Pane> = computed(() =>
  chatOnly.value || isChatOpen.value ? 'chat' : shown.value
)

/** Pins the page to its chat pane, once at boot of a chat tab. */
export function setChatOnly(): void {
  chatOnly.value = true
  setChatOpen(true)
}

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
