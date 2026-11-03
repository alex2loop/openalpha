import { type ReadonlySignal, signal } from '@preact/signals'

import type { BrowserKeys } from '@/app/server/wire/worker'
import { postToWorker } from '@/web/edition/worker-link'
import { loadSession } from '@/web/state/session'
import { readStorage, removeStorage, writeStorage } from '@/web/state/storage'

const KEYS_STORAGE_KEY = 'oa.keys'
const CONSENT_STORAGE_KEY = 'oa.consent'

export type KeySlot = 'ai' | 'search'

/** The providers a browser can call, per slot, in the order the page offers them. DeepSeek is in
 *  both: its AI key and its search key are different keys, so each slot holds its own. */
export const SLOT_PROVIDERS = Object.freeze({
  ai: ['openrouter', 'openai', 'deepseek'],
  search: ['tavily', 'serper', 'deepseek'],
} as const satisfies Record<KeySlot, readonly string[]>)

interface HeldKey {
  readonly provider: string
  readonly key: string
  /** Kept in this browser's `localStorage`; otherwise only in this page's memory. */
  readonly remembered: boolean
}

type Held = Readonly<Partial<Record<KeySlot, HeldKey>>>
/** `slot:provider` to the epoch ms the visitor agreed. */
type Consents = Readonly<Record<string, number>>

const held = signal<Held>(readHeld())
const consents = signal<Consents>(readConsents())

/** What the visitor holds now, key and memory flag; the key itself is for the panel's own field. */
export const heldKeys: ReadonlySignal<Held> = held
/** Which provider the visitor agreed to send to, from `consentId`. */
export const consentGiven: ReadonlySignal<Consents> = consents

export function consentId(slot: KeySlot, provider: string): string {
  return `${slot}:${provider}`
}

/** What the worker may use: a key counts only once its provider has the visitor's agreement. */
export function workerKeys(): BrowserKeys {
  return workerKeysOf(held.value, consents.value)
}

/** Holds a key for `slot`. It reaches the worker at once when the provider is agreed to, else when
 *  `grantConsent` is called. */
export function holdKey(slot: KeySlot, entry: HeldKey): void {
  held.value = { ...held.value, [slot]: entry }
  persistHeld()
  publish()
}

export function grantConsent(slot: KeySlot, provider: string): void {
  consents.value = { ...consents.value, [consentId(slot, provider)]: Date.now() }
  writeStorage('local', CONSENT_STORAGE_KEY, JSON.stringify(consents.value))
  publish()
}

/** "Xoá key": the key and the visitor's agreement for its provider go, so nothing more is sent. */
export function forgetKey(slot: KeySlot): void {
  const entry = held.value[slot]
  const { [slot]: removed, ...rest } = held.value

  held.value = rest

  if (entry !== undefined) {
    const { [consentId(slot, entry.provider)]: gone, ...remaining } = consents.value

    consents.value = remaining
    writeStorage('local', CONSENT_STORAGE_KEY, JSON.stringify(remaining))
  }

  persistHeld()
  publish()
}

// The worker applies a key from its next request; the session is read again so `modelReady` follows.
function publish(): void {
  postToWorker({ kind: 'keys', keys: workerKeys() })
  loadSession(new AbortController().signal).catch(() => undefined)
}

function workerKeysOf(keys: Held, agreed: Consents): BrowserKeys {
  const out: {
    ai?: { provider: string; key: string }
    search?: { provider: string; key: string }
  } = {}

  for (const slot of ['ai', 'search'] as const) {
    const entry = keys[slot]

    if (entry !== undefined && agreed[consentId(slot, entry.provider)] !== undefined) {
      out[slot] = { provider: entry.provider, key: entry.key }
    }
  }

  return out
}

function persistHeld(): void {
  const remembered = Object.fromEntries(
    Object.entries(held.value).filter(([, entry]) => entry.remembered)
  )

  if (Object.keys(remembered).length === 0) {
    removeStorage('local', KEYS_STORAGE_KEY)
  } else {
    writeStorage('local', KEYS_STORAGE_KEY, JSON.stringify(remembered))
  }
}

function readHeld(): Held {
  const parsed = parseObject(readStorage('local', KEYS_STORAGE_KEY))
  const out: { ai?: HeldKey; search?: HeldKey } = {}

  for (const slot of ['ai', 'search'] as const) {
    const entry = parsed[slot]

    if (isRecord(entry) && typeof entry.provider === 'string' && typeof entry.key === 'string') {
      out[slot] = { provider: entry.provider, key: entry.key, remembered: true }
    }
  }

  return out
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
