import { type ReadonlySignal, signal } from '@preact/signals'

import type {
  BrowserAiProvider,
  BrowserKeys,
  BrowserSearchProvider,
} from '@/app/server/wire/worker'
import { postToWorker } from '@/web/edition/worker-link'
import { loadSession } from '@/web/state/session'
import { readStorage, removeStorage, writeStorage } from '@/web/state/storage'

const KEYS_STORAGE_KEY = 'oa.keys'
const CONSENT_STORAGE_KEY = 'oa.consent'

/** The two places a key goes: the AI model, and web search. */
export const KEY_SLOTS = Object.freeze(['ai', 'search'] as const)
export type KeySlot = (typeof KEY_SLOTS)[number]
/** The provider the page offers first, and the one its sign-in flow connects. */
export const OPENROUTER = 'openrouter'

/** The providers a browser can call, per slot, in the order the page offers them. DeepSeek is in
 *  both: its AI key and its search key are different keys, so each slot holds its own. */
export const SLOT_PROVIDERS = Object.freeze({
  ai: [OPENROUTER, 'openai', 'deepseek', 'anthropic', 'gemini', 'xai', 'mistral'],
  search: ['tavily', 'serper', 'deepseek'],
} as const satisfies {
  readonly ai: readonly BrowserAiProvider[]
  readonly search: readonly BrowserSearchProvider[]
})

interface HeldKey {
  readonly provider: string
  readonly key: string
  /** Kept in this browser's `localStorage`; otherwise only in this page's memory. */
  readonly remembered: boolean
}

/** The AI slot holds one key per provider; the search slot holds one key. */
type Held = Readonly<Record<KeySlot, Readonly<Record<string, HeldKey>>>>
/** `slot:provider` to the epoch ms the visitor agreed. */
type Consents = Readonly<Record<string, number>>

function readHeld(): Held {
  const parsed = parseObject(readStorage('local', KEYS_STORAGE_KEY))

  return { ai: readSlot('ai', parsed.ai), search: readSlot('search', parsed.search) }
}

// Only a provider the slot offers and a text key survive: anything else in storage is dropped.
function readSlot(slot: KeySlot, stored: unknown): Readonly<Record<string, HeldKey>> {
  const entries = isRecord(stored) ? Object.entries(stored) : []

  return Object.fromEntries(
    entries.flatMap(([provider, key]) =>
      typeof key === 'string' && SLOT_PROVIDERS[slot].some((offered) => offered === provider)
        ? [[provider, { provider, key, remembered: true }]]
        : []
    )
  )
}

function readConsents(): Consents {
  const parsed = parseObject(readStorage('local', CONSENT_STORAGE_KEY))

  return Object.fromEntries(
    Object.entries(parsed).filter((pair): pair is [string, number] => typeof pair[1] === 'number')
  )
}

function parseObject(text: string | undefined): Record<string, unknown> {
  try {
    const value: unknown = text === undefined ? undefined : JSON.parse(text)

    return isRecord(value) ? value : {}
  } catch {
    return {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const held = signal<Held>(readHeld())
const consents = signal<Consents>(readConsents())

/** What the visitor holds now, key and memory flag; the key itself is for the panel's own field. */
export const heldKeys: ReadonlySignal<Held> = held

/** Whether the visitor agreed to send to `provider` with a key of `slot`. */
export function hasConsent(slot: KeySlot, provider: string): boolean {
  return isAgreed(consents.value, slot, provider)
}

/** What the worker may use: a key counts only once its provider has the visitor's agreement. */
export function workerKeys(): BrowserKeys {
  return workerKeysOf(held.value, consents.value)
}

/** Holds a key for `slot`. It reaches the worker at once when the provider is agreed to, else when
 *  `grantConsent` is called. An AI key replaces only its own provider's key; a search key replaces
 *  the search key held. */
export function holdKey(slot: KeySlot, entry: HeldKey): void {
  const kept = slot === 'ai' ? held.value.ai : {}

  held.value = { ...held.value, [slot]: { ...kept, [entry.provider]: entry } }
  persistHeld()
  publish()
}

export function grantConsent(slot: KeySlot, provider: string): void {
  holdConsents({ ...consents.value, [consentId(slot, provider)]: Date.now() })
  publish()
}

/** "Xóa key": one provider's key and the visitor's agreement for it go, so nothing more is sent. */
export function forgetKey(slot: KeySlot, provider: string): void {
  const { [provider]: removed, ...rest } = held.value[slot]
  const { [consentId(slot, provider)]: gone, ...remaining } = consents.value

  held.value = { ...held.value, [slot]: rest }
  holdConsents(remaining)
  persistHeld()
  publish()
}

/** Forgets every key and agreement held in this page's memory and tells the worker, so a run in
 *  flight stops spending at once. The wipe clears the storage itself and ends the worker after. */
export function dropHeldKeys(): void {
  clearHeld()
  sendKeys()
}

/** Follows the other tabs of this browser until `lifetime` aborts: a key or an agreement removed
 *  there is removed here, and "Delete all data" there empties this page too. */
export function watchKeyStorage(lifetime: AbortSignal): void {
  addEventListener('storage', onStorageChange, { signal: lifetime })
}

// The worker applies a key from its next request; the session is read again so `modelReady` follows.
function publish(): void {
  sendKeys()
  loadSession(new AbortController().signal).catch(() => undefined)
}

function sendKeys(): void {
  postToWorker({ kind: 'keys', keys: workerKeys() })
}

function clearHeld(): void {
  held.value = { ai: {}, search: {} }
  consents.value = {}
}

// A cleared storage (`key` null) is "Delete all data" elsewhere.
function onStorageChange({ key }: StorageEvent): void {
  const isWatched = key === null || key === KEYS_STORAGE_KEY || key === CONSENT_STORAGE_KEY

  if (!isWatched) {
    return
  }

  if (key === null) {
    clearHeld()
  } else {
    syncFromStorage()
  }

  publish()
}

// The remembered keys become what the storage holds, so a key removed in another tab goes and this
// page never writes it back. A key only this page holds stays; the search slot holds one key.
function syncFromStorage(): void {
  const stored = readHeld()

  held.value = { ai: syncSlot('ai', stored.ai), search: syncSlot('search', stored.search) }
  consents.value = readConsents()
}

function syncSlot(slot: KeySlot, stored: Held[KeySlot]): Held[KeySlot] {
  const unsaved = Object.fromEntries(
    Object.entries(held.value[slot]).filter(([, entry]) => !entry.remembered)
  )
  const kept = slot === 'search' && Object.keys(unsaved).length > 0 ? {} : stored

  return { ...kept, ...unsaved }
}

function workerKeysOf(keys: Held, agreed: Consents): BrowserKeys {
  const sendable = (slot: KeySlot) =>
    Object.values(keys[slot])
      .filter((entry) => isAgreed(agreed, slot, entry.provider))
      .map(({ provider, key }) => ({ provider, key }))
  const [search] = sendable('search')

  return { ai: sendable('ai'), ...(search === undefined ? {} : { search }) }
}

function consentId(slot: KeySlot, provider: string): string {
  return `${slot}:${provider}`
}

function isAgreed(agreed: Consents, slot: KeySlot, provider: string): boolean {
  return agreed[consentId(slot, provider)] !== undefined
}

function holdConsents(next: Consents): void {
  consents.value = next
  writeStorage('local', CONSENT_STORAGE_KEY, JSON.stringify(next))
}

function persistHeld(): void {
  const remembered = KEY_SLOTS.map((slot) => [slot, rememberedOf(slot)] as const)

  if (remembered.every(([, entries]) => Object.keys(entries).length === 0)) {
    removeStorage('local', KEYS_STORAGE_KEY)
  } else {
    writeStorage('local', KEYS_STORAGE_KEY, JSON.stringify(Object.fromEntries(remembered)))
  }
}

function rememberedOf(slot: KeySlot): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.values(held.value[slot])
      .filter((entry) => entry.remembered)
      .map((entry) => [entry.provider, entry.key])
  )
}
