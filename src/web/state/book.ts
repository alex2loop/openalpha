import { signal } from '@preact/signals'

import { openView } from '@/web/state/panel'

export type BookTab = 'overview' | 'performance' | 'history' | 'rebalance' | 'watch' | 'orders'

/** The Danh mục sub-tab; it outlives the panel's remounts, so the way back restores it. */
export const bookTab = signal<BookTab>('overview')

/** Opens Danh mục on `tab`. */
export function openBook(tab: BookTab): void {
  bookTab.value = tab
  openView({ tab: 'book' })
}
