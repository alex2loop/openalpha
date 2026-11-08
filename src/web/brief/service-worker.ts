// The app's service worker: the shell is cached when it installs, in a cache named for the build,
// so the page opens with no network and a build never mixes its files with another's. The latest
// brief lives in a cache of its own and is asked of the network first, with the last copy as the
// fallback. A push carries nothing: the worker reads the headline itself and shows it in the
// reader's language. The DOM library has no service worker scope, so the little this file uses is
// declared here, with the constants the build fills in.
import type { PublicBriefDocument } from '@/app/server/wire/public-brief'
import { isDocument } from '@/app/server/wire/public-brief-document'
import { APP_ROOT, TAB_ICON_FILE } from '@/web/brief/install-look'
import {
  LATEST_CACHE,
  LATEST_PATH,
  NOT_FOUND,
  OFFLINE_HEADER,
  PUSH_LOCALE_KEY,
} from '@/web/brief/load'
import { type Locale, phoneLocale, toLocale } from '@/web/brief/strings'
import { vnToday } from '@/web/brief/today'

declare const PRECACHE_URLS: readonly string[]
declare const BUILD_ID: string
declare const PUSH_STRINGS: Readonly<Record<Locale, Readonly<Record<string, string>>>>

// Shorter than the page's own wait, so a slow network answers from the cache before the page gives up.
const LATEST_TIMEOUT_MS = 6_000
const PRECACHE_TIMEOUT_MS = 30_000
const SHELL_TIMEOUT_MS = 10_000
// A push waits less: the notification must not lag behind the push.
const PUSH_LATEST_TIMEOUT_MS = 3_000
// One tag, so a second push replaces the notification instead of stacking beside it.
const PUSH_TAG = 'brief'
const SHELL_CACHE = `shell-${BUILD_ID}`
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

interface NotificationEvent extends LifecycleEvent {
  readonly notification: Notification
}

interface WindowClient {
  focus(): Promise<unknown>
  navigate(url: string): Promise<unknown>
}

interface ServiceWorkerScope {
  readonly clients: {
    claim(): Promise<void>
    matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<WindowClient[]>
    openWindow(url: string): Promise<unknown>
  }
  readonly registration: {
    showNotification(title: string, options: NotificationOptions): Promise<void>
  }
  skipWaiting(): Promise<void>
  addEventListener(
    type: 'install' | 'activate' | 'push',
    listener: (event: LifecycleEvent) => void
  ): void
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void
  addEventListener(type: 'notificationclick', listener: (event: NotificationEvent) => void): void
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
scope.addEventListener('push', (event) => {
  event.waitUntil(showBrief())
})
scope.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(openApp())
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

    if (response.ok && (await keepLatest(response.clone())) !== undefined) {
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

// The brief in the answer, when the page can show it. Only such a brief is kept: a copy it cannot
// show would also fail offline, and would replace the last good one.
async function keepLatest(response: Response): Promise<PublicBriefDocument | undefined> {
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => undefined)

  if (!isDocument(body)) {
    return undefined
  }

  try {
    await (await openLatest()).put(LATEST_PATH, response)
  } catch {
    // A full cache only costs the offline copy; the reader still gets the answer.
  }

  return body
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

// The notification always shows: the headline when the network gives today's brief in time, a plain
// line otherwise. A push without a notification would make the phone show one of its own.
async function showBrief(): Promise<void> {
  const locale = await pushLocale()
  const headline = await todaysHeadline(locale)

  await scope.registration.showNotification(pushWord(locale, 'ui.brief.push.title'), {
    body: headline ?? pushWord(locale, 'ui.brief.push.fallback'),
    icon: APP_ROOT + TAB_ICON_FILE,
    tag: PUSH_TAG,
    lang: locale,
  })
}

// The language the page kept for the reminder, else the phone's.
async function pushLocale(): Promise<Locale> {
  try {
    const kept = await (await openLatest()).match(PUSH_LOCALE_KEY)

    return toLocale(await kept?.text()) ?? phoneLocale()
  } catch {
    // An unreadable cache reads as no language kept.
    return phoneLocale()
  }
}

// The newest brief is read afresh and kept, so a tap on the notification opens on it. Another
// colo's edge cache can still hold yesterday's for a minute: that headline is not announced.
async function todaysHeadline(locale: Locale): Promise<string | undefined> {
  try {
    const response = await fetch(LATEST_PATH, {
      cache: 'no-store',
      signal: AbortSignal.timeout(PUSH_LATEST_TIMEOUT_MS),
    })
    const doc = response.ok ? await keepLatest(response) : undefined

    return doc?.day === vnToday(Date.now()) ? doc.headline[locale] : undefined
  } catch {
    // Offline, timed out or refused: the notification carries the plain line.
    return undefined
  }
}

function pushWord(locale: Locale, key: string): string {
  return PUSH_STRINGS[locale][key] ?? key
}

// An open window comes forward and shows today's brief; with none open, one opens.
async function openApp(): Promise<void> {
  const [open] = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true })

  if (open === undefined) {
    await scope.clients.openWindow(APP_ROOT)

    return
  }

  await open.focus()
  // A window the worker does not control refuses to navigate; it stays focused where it was.
  await open.navigate(APP_ROOT).catch(() => undefined)
}
