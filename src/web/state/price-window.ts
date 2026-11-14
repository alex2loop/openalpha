import { signal } from '@preact/signals'

import type { PriceWindow } from '@/app/server/wire/vocab'
import { readStorage, writeStorage } from '@/web/state/storage'

const PRICE_WINDOW_STORAGE_KEY = 'office.priceWindow'
const DEFAULT_PRICE_WINDOW: PriceWindow = '3m'

/** The spans the daemon reads a name's price chart over, shortest first. */
export const PRICE_WINDOWS: readonly PriceWindow[] = Object.freeze(['1m', '3m', '6m', '1y'])

// The last span picked in this browser, kept across visits; one the page no longer offers reads as
// the default.
const storedWindow = readStorage('local', PRICE_WINDOW_STORAGE_KEY)

/** The span every ticker card's chart is read over. */
export const priceWindow = signal<PriceWindow>(
  PRICE_WINDOWS.find((choice) => choice === storedWindow) ?? DEFAULT_PRICE_WINDOW
)

export function pickPriceWindow(choice: PriceWindow): void {
  priceWindow.value = choice
  writeStorage('local', PRICE_WINDOW_STORAGE_KEY, choice)
}
