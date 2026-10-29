import { computed, signal } from '@preact/signals'

import type { StatePayload } from '@/app/server/wire/system'
import type { ConnectionStatus } from '@/web/api/socket'
import { noteSignedIn } from '@/web/api/auth-state'
import { nextDelayMs } from '@/web/api/backoff'
import { ApiFailure, getJson, setSlowRequestMs } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { signInWithCode } from '@/web/api/sign-in'

const FALLBACK_UI_LOCALE: UiLocale = 'vi'
type UiLocale = StatePayload['locale']

/** The feed socket's state; `retryAt` (epoch ms) is when an `offline` socket tries again. */
interface Connection {
  readonly status: ConnectionStatus
  readonly retryAt?: number
}

function resolveBrowserLocale(): UiLocale {
  const primary = navigator.language.split('-')[0]?.toLowerCase()

  return primary === 'en' || primary === 'vi' ? primary : FALLBACK_UI_LOCALE
}

const browserLocale = resolveBrowserLocale()

/** The product name from `GET /v1/health`, known before sign-in. */
export const brand = signal<string | undefined>(undefined)
/** `GET /v1/health` failed: the daemon that served this page is down; the page keeps asking. */
export const isUnreachable = signal(false)
/** `GET /v1/health` answered `starting`: the daemon is up but still loading; the page keeps asking. */
export const isStarting = signal(false)
/** Written by the feed only. */
export const connection = signal<Connection>({ status: 'connecting' })
/** The last good `GET /v1/state`. */
export const state = signal<StatePayload | undefined>(undefined)
/** Why the last `GET /v1/state` failed; cleared by the next success. */
export const sessionFailure = signal<ApiFailure | undefined>(undefined)
/** The browser's language until a session loads, then the daemon's. */
export const locale = computed<UiLocale>(() => state.value?.locale ?? browserLocale)

/** A model can answer: a key or login is set, or the connected client answers. */
export const isModelReady = computed(() => state.value?.firstRun.modelReady === true)

/** No saved profile and an empty book: the page walks the operator through the first steps, the
 *  model key among them. */
export const isFirstRun = computed(() => {
  const firstRun = state.value?.firstRun

  return firstRun !== undefined && !firstRun.profileSaved && firstRun.bookEmpty
})

/** Asks `GET /v1/health` until the daemon answers `ready`, on the backoff while it cannot be reached
 *  and at its first step while it is starting. Then trades a sign-in `code` when the address carried one, and loads the
 *  session. A code the daemon never answered stays in the address and is tried again. */
export async function loadUntilReady(abortSignal: AbortSignal, code?: string): Promise<void> {
  let tries = 0

  while (!abortSignal.aborted) {
    await loadBrand(abortSignal)

    if (!(isUnreachable.value || isStarting.value)) {
      const isTraded = code === undefined || (await signInWithCode(code, abortSignal))

      if (isTraded) {
        await loadSession(abortSignal)
        return
      }
    }

    // A daemon that answers `starting` is about a second from ready: ask again at the first step.
    await waitFor(nextDelayMs(isStarting.value ? 0 : tries++, Math.random), abortSignal)
  }
}

/** Keeps the last good values when a load fails; a 401 flips `authState` in the client. */
export async function loadSession(abortSignal: AbortSignal): Promise<void> {
  try {
    const next = await getJson(ROUTES.state, { signal: abortSignal })

    setSlowRequestMs(next.slowRequestMs)
    state.value = next
    sessionFailure.value = undefined
    noteSignedIn()
  } catch (error: unknown) {
    if (error instanceof ApiFailure) {
      sessionFailure.value = error
    }
  }
}

async function loadBrand(abortSignal: AbortSignal): Promise<void> {
  try {
    const health = await getJson(ROUTES.health, { signal: abortSignal })

    brand.value = health.brand
    isUnreachable.value = false
    isStarting.value = health.status === 'starting'
  } catch (error: unknown) {
    // Anything but an `ApiFailure` is the caller's own abort.
    if (error instanceof ApiFailure) {
      isUnreachable.value = true
    }
  }
}

// Settles on the timer or on abort, whichever comes first, and leaves neither behind.
function waitFor(ms: number, abortSignal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (abortSignal.aborted) {
      resolve()
      return
    }

    const timer = setTimeout(settle, ms)

    abortSignal.addEventListener('abort', settle, { once: true })

    function settle(): void {
      clearTimeout(timer)
      abortSignal.removeEventListener('abort', settle)
      resolve()
    }
  })
}
