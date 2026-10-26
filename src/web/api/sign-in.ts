import { signal } from '@preact/signals'

import type { BrowserSignInBody } from '@/app/server/wire/sign-in'
import { ROUTES } from '@/web/api/routes'

const CODE_HASH_PARAM = 'code'
const SIGN_IN_TIMEOUT_MS = 20_000
const UNAUTHORIZED_STATUS = 401
const FORBIDDEN_STATUS = 403
const JSON_CONTENT_TYPE = 'application/json'

export type AuthState = 'ok' | 'signed-out' | 'code-refused' | 'cookie-blocked' | 'ended'

// Page-lifetime facts behind `noteRefused`: a code was just traded, and a load has succeeded.
let isFreshSignIn = false
let hasSignedIn = false

/** `ok` until a load says otherwise. */
export const authState = signal<AuthState>('ok')

/** The `#code=` of a sign-in link. The hash leaves the address without a history entry, so neither
 *  the address bar nor the back button keeps the code. */
export function takeCodeFromHash(): string | undefined {
  const code = new URLSearchParams(location.hash.slice(1)).get(CODE_HASH_PARAM)?.trim()

  if (code === undefined) {
    return undefined
  }

  history.replaceState(null, '', location.pathname + location.search)

  return code === '' ? undefined : code
}

/** Trades a code for the session cookie. A refused code reads as `code-refused`; any other failure
 *  is left to the session load that follows. Its own fetch: the client calls back into this file. */
export async function signInWithCode(code: string, abortSignal: AbortSignal): Promise<void> {
  const body: BrowserSignInBody = { code }
  let response: Response

  try {
    response = await fetch(ROUTES.sessionExchange.path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': JSON_CONTENT_TYPE },
      body: JSON.stringify(body),
      signal: AbortSignal.any([abortSignal, AbortSignal.timeout(SIGN_IN_TIMEOUT_MS)]),
    })
  } catch (error: unknown) {
    if (abortSignal.aborted) {
      throw error
    }

    return
  }

  if (response.ok) {
    isFreshSignIn = true
  } else if (response.status === UNAUTHORIZED_STATUS || response.status === FORBIDDEN_STATUS) {
    authState.value = 'code-refused'
  }
}

export function noteSignedIn(): void {
  isFreshSignIn = false
  hasSignedIn = true
  authState.value = 'ok'
}

/** A 401 right after a good exchange means the cookie never came back; after a signed-in load the
 *  session ended. A screen already showing stays: a refused code or a sign-out says it better. */
export function noteRefused(): void {
  if (authState.value !== 'ok') {
    return
  }

  if (isFreshSignIn) {
    authState.value = 'cookie-blocked'
    return
  }

  authState.value = hasSignedIn ? 'ended' : 'signed-out'
}
