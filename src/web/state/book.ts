import { signal } from '@preact/signals'

import type { NavWindow } from '@/app/server/wire/vocab'
import { openView } from '@/web/state/panel'
import { readStorage, writeStorage } from '@/web/state/storage'

const NAV_WINDOW_STORAGE_KEY = 'office.navWindow'
const DEFAULT_NAV_WINDOW: NavWindow = '1y'

/** The windows the daemon reads the book's record over, shortest first. */
export const NAV_WINDOWS: readonly NavWindow[] = Object.freeze(['1m', '3m', '6m', '1y', 'all'])

export type BookTab = 'overview' | 'performance' | 'history' | 'rebalance' | 'watch' | 'orders'

/** The Danh mục sub-tab; it outlives the panel's remounts, so the way back restores it. */
export const bookTab = signal<BookTab>('overview')

// The last window picked in this browser, kept across visits; one the page no longer offers reads
// as the default.
const storedWindow = readStorage('local', NAV_WINDOW_STORAGE_KEY)

/** The window Hiệu quả reads the book's record over. */
export const navWindow = signal<NavWindow>(
  NAV_WINDOWS.find((choice) => choice === storedWindow) ?? DEFAULT_NAV_WINDOW
)

/** Opens Danh mục on `tab`. */
export function openBook(tab: BookTab): void {
  bookTab.value = tab
  openView({ tab: 'book' })
}

export function pickNavWindow(choice: NavWindow): void {
  navWindow.value = choice
  writeStorage('local', NAV_WINDOW_STORAGE_KEY, choice)
}
