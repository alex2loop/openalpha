// The app's service worker: the shell is cached when it installs, in a cache named for the build,
// so the page opens with no network and a build never mixes its files with another's. The latest
// brief lives in a cache of its own and is asked of the network first, with the last copy as the
// fallback. The DOM library has no service worker scope, so the little this file uses is declared
// here, with the two constants the build fills in.
import { isDocument } from '@/app/server/wire/public-brief-document'
import { LATEST_PATH, NOT_FOUND, OFFLINE_HEADER } from '@/web/brief/load'

declare const PRECACHE_URLS: readonly string[]
declare const BUILD_ID: string

// Shorter than the page's own wait, so a slow network answers from the cache before the page gives up.
const LATEST_TIMEOUT_MS = 6_000
const PRECACHE_TIMEOUT_MS = 30_000
const SHELL_TIMEOUT_MS = 10_000
const SHELL_CACHE = `shell-${BUILD_ID}`
const LATEST_CACHE = 'latest'
const CACHES_KEPT: ReadonlySet<string> = new Set([SHELL_CACHE, LATEST_CACHE])
const SHELL_URLS: ReadonlySet<string> = new Set(PRECACHE_URLS)
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
// older one, and kept under its plain address in this build's cache. An install that fails part
// way leaves the cache it was filling for the next try; the worker in charge keeps its own.
async function precache(): Promise<void> {
  const cache = await caches.open(SHELL_CACHE)

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

// Every cache but this build's shell and the latest brief goes: the shells of other builds, once
// this one is in charge.
async function prune(): Promise<void> {
  await Promise.all(
    (await caches.keys())
      .filter((name) => !CACHES_KEPT.has(name))
      .map((name) => caches.delete(name))
  )
}

async function answerShell(request: Request): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE)

  return (
    (await cache.match(request, LOOKUP)) ??
    (await fetch(request, { signal: AbortSignal.timeout(SHELL_TIMEOUT_MS) }))
  )
}

// The network first, so a new brief shows at once. A brief the network could not give, or gave in a
// form the page cannot show, is the last copy, marked so the page can say so; a 404 is an answer
// (nothing published, or taken down) and drops the copy.
async function answerLatest(request: Request): Promise<Response> {
  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(LATEST_TIMEOUT_MS) })

    if (response.ok && (await keepLatest(response.clone()))) {
      return response
    }

    if (response.status === NOT_FOUND) {
      await (await openLatest()).delete(LATEST_PATH)

      return response
    }

    return (await copyOfLatest()) ?? response
  } catch {
    // Offline, timed out or refused: the last copy, or the failure itself.
    return (await copyOfLatest()) ?? Response.error()
  }
}

// Whether the page can show the answer. Only such a brief is kept: a copy it cannot show would also
// fail offline, and would replace the last good one.
async function keepLatest(response: Response): Promise<boolean> {
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => undefined)

  if (!isDocument(body)) {
    return false
  }

  try {
    await (await openLatest()).put(LATEST_PATH, response)
  } catch {
    // A full cache only costs the offline copy; the reader still gets the answer.
  }

  return true
}

async function copyOfLatest(): Promise<Response | undefined> {
  const cached = await (await openLatest()).match(LATEST_PATH, LOOKUP)

  if (cached === undefined) {
    return undefined
  }

  const headers = new Headers(cached.headers)

  headers.set(OFFLINE_HEADER, '1')

  return new Response(cached.body, { status: cached.status, headers })
}

function openLatest(): Promise<Cache> {
  return caches.open(LATEST_CACHE)
}
