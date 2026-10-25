import { computed, signal } from '@preact/signals'

import type { StatePayload } from '@/app/server/wire/system'
import { ApiFailure, getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { authState, readToken } from '@/web/api/token'

type UiLocale = StatePayload['locale']

const FALLBACK_UI_LOCALE: UiLocale = 'vi'

/** The product name from `GET /v1/health`, known before sign-in. */
export const brand = signal<string | undefined>(undefined)
/** `GET /v1/health` failed: the daemon that served this page has stopped. */
export const isUnreachable = signal(false)
/** The last good `GET /v1/state`. */
export const state = signal<StatePayload | undefined>(undefined)
/** Why the last `GET /v1/state` failed; cleared by the next success. */
export const sessionFailure = signal<ApiFailure | undefined>(undefined)

const browserLocale = resolveBrowserLocale()

/** The browser's language until a session loads, then the daemon's. */
export const locale = computed<UiLocale>(() => state.value?.locale ?? browserLocale)

export async function loadBrand(abortSignal: AbortSignal): Promise<void> {
  try {
    const health = await getJson(ROUTES.health, { signal: abortSignal })

    brand.value = health.brand
    isUnreachable.value = false
  } catch (error: unknown) {
    // Anything but an `ApiFailure` is the caller's own abort.
    if (error instanceof ApiFailure) {
      isUnreachable.value = true
    }
  }
}

/** Keeps the last good values when a load fails; a refused token flips `authState` in the client. */
export async function loadSession(abortSignal: AbortSignal): Promise<void> {
  if (readToken() === undefined) {
    authState.value = 'missing'
    return
  }

  try {
    state.value = await getJson(ROUTES.state, { signal: abortSignal })
    sessionFailure.value = undefined
    authState.value = 'ok'
  } catch (error: unknown) {
    if (error instanceof ApiFailure) {
      sessionFailure.value = error
    }
  }
}

function resolveBrowserLocale(): UiLocale {
  const primary = navigator.language.split('-')[0]?.toLowerCase()

  return primary === 'en' || primary === 'vi' ? primary : FALLBACK_UI_LOCALE
}
