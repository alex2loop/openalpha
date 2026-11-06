// The app's service worker: the shell is cached when it installs, so the page opens with no
// network, and the latest brief is asked of the network first with the last copy as the fallback. The DOM library has no service worker scope, so the little this file uses is
// declared here, with the two constants the build fills in.
import { CACHE_NAME, LATEST_PATH, LOCALE_PATH, OFFLINE_HEADER } from '@/web/brief/load'

declare const PRECACHE_URLS: readonly string[]
declare const BUILD_ID: string

// Shorter than the page's own wait, so a slow network answers from the cache before the page gives up.
const LATEST_TIMEOUT_MS = 6_000
const PRECACHE_TIMEOUT_MS = 30_000
const SHELL_TIMEOUT_MS = 10_000
const NOT_FOUND = 404
const SHELL_URLS: ReadonlySet<string> = new Set(PRECACHE_URLS)
const KEPT_URLS: ReadonlySet<string> = new Set([...PRECACHE_URLS, LATEST_PATH, LOCALE_PATH])
const LOOKUP = { ignoreSearch: true, ignoreVary: true } as const

interface LifecycleEvent extends Event {
  waitUntil(promise: Promise<unknown>): void
}

interface FetchEvent extends LifecycleEvent {
  readonly request: Request
  respondWith(response: Promise<Response>): void
}

interface ServiceWorkerScope {
  readonly clients: { claim(): Promise<void> }
  skipWaiting(): Promise<void>
  addEventListener(type: 'install' | 'activate', listener: (event: LifecycleEvent) => void): void
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void
}

// Safe: `self` is this worker's global scope, which has these members; the DOM library types it as
// a window.
const scope = self as unknown as ServiceWorkerScope

scope.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => scope.skipWaiting()))
})
scope.addEventListener('activate', (event) => {
  event.waitUntil(prune().then(() => scope.clients.claim()))
})
scope.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method !== 'GET' || url.origin !== location.origin) {
    return
  }

  if (url.pathname === LATEST_PATH) {
    event.respondWith(answerLatest(request))
  } else if (SHELL_URLS.has(url.pathname)) {
    event.respondWith(answerShell(request))
  }
})

// Each file is asked for with the build's digest in its address, so no HTTP cache answers with an
// older one, and kept under its plain address.
async function precache(): Promise<void> {
  const cache = await caches.open(CACHE_NAME)

  await Promise.all(
    PRECACHE_URLS.map(async (url) => {
      const response = await fetch(`${url}?build=${BUILD_ID}`, {
        signal: AbortSignal.timeout(PRECACHE_TIMEOUT_MS),
      })

      if (!response.ok) {
        throw new TypeError(`${url} answered ${response.status}`)
      }

      await cache.put(url, response)
    })
  )
}

// Another build's caches go, and so does whatever this build no longer lists.
async function prune(): Promise<void> {
  await Promise.all(
    (await caches.keys()).filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
  )

  const cache = await caches.open(CACHE_NAME)

  await Promise.all(
    (await cache.keys())
      .filter((request) => !KEPT_URLS.has(new URL(request.url).pathname))
      .map((request) => cache.delete(request))
  )
}

async function answerShell(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME)

  return (
    (await cache.match(request, LOOKUP)) ??
    (await fetch(request, { signal: AbortSignal.timeout(SHELL_TIMEOUT_MS) }))
  )
}

// The network first, so a new brief shows at once. A brief the network could not give is the last
// copy, marked so the page can say so; a 404 is an answer (nothing published, or taken down) and
// drops the copy.
async function answerLatest(request: Request): Promise<Response> {
  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(LATEST_TIMEOUT_MS) })

    if (response.ok) {
      await keepLatest(response.clone())

      return response
    }

    if (response.status === NOT_FOUND) {
      await (await caches.open(CACHE_NAME)).delete(LATEST_PATH)

      return response
    }

    return (await copyOfLatest()) ?? response
  } catch {
    // Offline, timed out or refused: the last copy, or the failure itself.
    return (await copyOfLatest()) ?? Response.error()
  }
}

async function keepLatest(response: Response): Promise<void> {
  try {
    await (await caches.open(CACHE_NAME)).put(LATEST_PATH, response)
  } catch {
    // A full cache only costs the offline copy; the reader still gets the brief.
  }
}

async function copyOfLatest(): Promise<Response | undefined> {
  const cached = await (await caches.open(CACHE_NAME)).match(LATEST_PATH, LOOKUP)

  if (cached === undefined) {
    return undefined
  }

  const headers = new Headers(cached.headers)

  headers.set(OFFLINE_HEADER, '1')

  return new Response(cached.body, { status: cached.status, headers })
}
