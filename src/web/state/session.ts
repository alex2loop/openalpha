import { computed, signal } from '@preact/signals'

import type { StatePayload } from '@/app/server/wire/system'
import type { ConnectionStatus } from '@/web/api/socket'
import { noteSignedIn } from '@/web/api/auth-state'
import { nextDelayMs } from '@/web/api/backoff'
import { ApiFailure, getJson, setSlowRequestMs } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { signInWithCode } from '@/web/api/sign-in'

const FALLBACK_UI_LOCALE: UiLocale = 'vi'
// A booting daemon answers `/v1/health` with `starting`; the page asks again until it is ready.
const STARTING_RETRY_MS = 1_000
const STARTING_RETRY_LIMIT = 30

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
/** `GET /v1/health` answered `starting`: the daemon is still coming up. */
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

/** Trades a sign-in `code` first when the address carried one, then loads brand and session, again
 *  every `STARTING_RETRY_MS` while the daemon is starting, at most `STARTING_RETRY_LIMIT` times, and
 *  on the backoff for as long as it cannot be reached. */
export async function loadUntilReady(abortSignal: AbortSignal, code?: string): Promise<void> {
  if (code !== undefined) {
    await signInWithCode(code, abortSignal)
  }

  let startingTries = 0
  let unreachableTries = 0

  while (!abortSignal.aborted) {
    await Promise.all([loadBrand(abortSignal), loadSession(abortSignal)])

    if (isUnreachable.value) {
      await waitFor(nextDelayMs(unreachableTries++, Math.random), abortSignal)
      continue
    }

    if (!isStarting.value) {
      return
    }

    if (startingTries++ >= STARTING_RETRY_LIMIT) {
      isStarting.value = false
      return
    }

    await waitFor(STARTING_RETRY_MS, abortSignal)
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
    isStarting.value = health.status === 'starting'
    isUnreachable.value = false
  } catch (error: unknown) {
    // Anything but an `ApiFailure` is the caller's own abort.
    if (error instanceof ApiFailure) {
      isStarting.value = false
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
