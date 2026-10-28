import { computed, type ReadonlySignal, signal } from '@preact/signals'

import type { SuggestionWire } from '@/app/server/wire/trading'
import { freshCalls } from '@/web/state/market'
import { openView } from '@/web/state/panel'
import { readStorage, writeStorage } from '@/web/state/storage'

const SEEN_STORAGE_KEY = 'office.seenCalls'
// The newest calls the operator has looked at; an older one never comes back as open.
const SEEN_MAX = 200

export type IdeasTab = 'open' | 'screen' | 'record'

/** The Đề xuất sub-tab; it outlives the panel's remounts, so the way back restores it. */
export const ideasTab = signal<IdeasTab>('open')
/** The market the Cơ hội board reads; absent until the operator or a command picks one. */
export const screenMarket = signal<string | undefined>(undefined)

const seen = signal<readonly string[]>(readSeen())

/** The standing buy calls the operator has not looked at yet. */
export const unseenCalls: ReadonlySignal<readonly SuggestionWire[]> = computed(() =>
  freshCalls.value.filter((call) => !seen.value.includes(call.id))
)

/** Opens Đề xuất on `tab`; `market` picks the board for Cơ hội. */
export function openIdeas(tab: IdeasTab, market?: string): void {
  ideasTab.value = tab

  if (market !== undefined) {
    screenMarket.value = market
  }

  openView({ tab: 'ideas' })
}

/** Remembers that these calls were in front of the operator. */
export function markSeen(ids: readonly string[]): void {
  const next = [...seen.value, ...ids.filter((id) => !seen.value.includes(id))].slice(-SEEN_MAX)

  seen.value = next
  writeStorage('local', SEEN_STORAGE_KEY, JSON.stringify(next))
}

function readSeen(): readonly string[] {
  const stored = readStorage('local', SEEN_STORAGE_KEY)

  if (stored === undefined) {
    return []
  }

  try {
    const parsed: unknown = JSON.parse(stored)

    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string').slice(-SEEN_MAX)
      : []
  } catch {
    // A stored value this page did not write reads as nothing seen.
    return []
  }
}
