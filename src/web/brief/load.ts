import type { PublicBriefDocument } from '@/app/server/wire/public-brief'
import { vnToday } from '@/web/brief/today'

export const LATEST_PATH = '/api/latest'
/** What the service worker keeps: the app shell, the last brief and the chosen language. */
export const CACHE_NAME = 'brief-v1'
/** Where the page leaves the chosen language for the push handler. */
export const LOCALE_PATH = '/__locale'
/** Set by the service worker on a brief it answered from its cache because the network failed. */
export const OFFLINE_HEADER = 'X-Brief-Offline'

const FETCH_TIMEOUT_MS = 8_000
const NOT_FOUND = 404
const SCHEMA = 1
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export type LatestState =
  | { readonly kind: 'ready'; readonly doc: PublicBriefDocument; readonly isToday: boolean }
  | { readonly kind: 'offline'; readonly doc: PublicBriefDocument }
  | { readonly kind: 'empty' }
  | { readonly kind: 'failed' }

/** The newest brief, or why there is none. Never rejects: a read that was aborted, ran out of time
 *  or got an answer it cannot show is `failed`, and the caller drops the answer it no longer wants. */
export async function loadLatest(signal: AbortSignal): Promise<LatestState> {
  const now = Date.now()

  try {
    return await withDeadline(signal, async (bounded) => {
      const response = await fetch(LATEST_PATH, { cache: 'no-store', signal: bounded })

      if (response.status === NOT_FOUND) {
        return { kind: 'empty' }
      }

      const doc: unknown = response.ok ? await response.json() : undefined

      if (!isDocument(doc)) {
        return { kind: 'failed' }
      }

      if (response.headers.has(OFFLINE_HEADER)) {
        return { kind: 'offline', doc }
      }

      return { kind: 'ready', doc, isToday: doc.day === vnToday(now) }
    })
  } catch {
    // A network error, a timeout, the caller's abort or a body that is not JSON: no brief to show.
    return { kind: 'failed' }
  }
}

/** Runs `work` with a signal that aborts when `signal` does or after the fetch timeout, and lets go
 *  of both on every way out. */
export async function withDeadline<T>(
  signal: AbortSignal,
  work: (bounded: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timer = setTimeout(abort, FETCH_TIMEOUT_MS)

  if (signal.aborted) {
    abort()
  }

  signal.addEventListener('abort', abort, { once: true })

  try {
    return await work(controller.signal)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

function isDocument(value: unknown): value is PublicBriefDocument {
  return (
    isRecord(value) &&
    value.schema === SCHEMA &&
    typeof value.day === 'string' &&
    DAY_RE.test(value.day) &&
    hasBothLocales(value.briefs, isBrief) &&
    hasBothLocales(value.screens, Array.isArray) &&
    hasBothLocales(value.headline, isText)
  )
}

function hasBothLocales(value: unknown, test: (item: unknown) => boolean): boolean {
  return isRecord(value) && test(value.vi) && test(value.en)
}

function isBrief(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.title === 'string' &&
    typeof value.readingLines === 'number' &&
    Array.isArray(value.verdict) &&
    Array.isArray(value.story) &&
    Array.isArray(value.sections) &&
    Array.isArray(value.caveats)
  )
}

function isText(value: unknown): boolean {
  return typeof value === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
