import { signal } from '@preact/signals'

export type AuthState =
  | 'ok'
  | 'signed-out'
  | 'code-refused'
  | 'locked'
  | 'sign-in-failed'
  | 'cookie-blocked'
  | 'ended'

// Page-lifetime facts behind `noteRefused`: a code was just traded, a load has succeeded, and this
// browser is signing itself out.
let isFreshSignIn = false
let hasSignedIn = false
let isSigningOut = false

/** `ok` until a load says otherwise. */
export const authState = signal<AuthState>('ok')
/** The daemon's own sentence for a `sign-in-failed` refusal; empty when it sent none. */
export const refusalMessage = signal('')

export function noteCodeTraded(): void {
  isFreshSignIn = true
}

export function noteSignedIn(): void {
  isFreshSignIn = false
  hasSignedIn = true
  authState.value = 'ok'
}

/** Until `noteSignOutSettled`, a 401 reads as this browser's own sign-out, not an ended session. */
export function noteSigningOut(): void {
  isSigningOut = true
}

export function noteSignOutSettled(): void {
  isSigningOut = false
}

/** A 401 right after a good exchange means the cookie never came back; after a signed-in load the
 *  session ended. A screen already showing stays: a refused code or a sign-out says it better. */
export function noteRefused(): void {
  if (authState.value !== 'ok') {
    return
  }

  if (isSigningOut) {
    authState.value = 'signed-out'
    return
  }

  if (isFreshSignIn) {
    authState.value = 'cookie-blocked'
    return
  }

  authState.value = hasSignedIn ? 'ended' : 'signed-out'
}
