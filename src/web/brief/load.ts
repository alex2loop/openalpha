import type { PublicBriefDocument } from '@/app/server/wire/public-brief'
import { isDocument } from '@/app/server/wire/public-brief-document'
import { vnToday } from '@/web/brief/today'

export const LATEST_PATH = '/api/latest'
export const NOT_FOUND = 404
/** Set by the service worker on a brief it answered from its cache because the network failed. */
export const OFFLINE_HEADER = 'X-Brief-Offline'

const FETCH_TIMEOUT_MS = 8_000

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
    return await withFetchDeadline(signal, async (bounded) => {
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
export async function withFetchDeadline<T>(
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
