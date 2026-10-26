import { authState, noteCodeTraded, noteSigningOut, noteSignOutSettled } from '@/web/api/auth-state'
import { ApiFailure, sendJson, UNAUTHORIZED_STATUS } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'

const CODE_HASH_PARAM = 'code'
const TOKEN_HASH_PARAM = 'token'
// The daemon's answer while wrong codes have locked sign-in for this address.
const LOCKED_STATUS = 403

/** The `#code=` of a sign-in link. The hash leaves the address without a history entry, so neither
 *  the address bar nor the back button keeps the code. A `#token=` is dropped the same way, never
 *  read or sent: the page never holds the API token. */
export function takeCodeFromHash(): string | undefined {
  const params = new URLSearchParams(location.hash.slice(1))
  const code = params.get(CODE_HASH_PARAM)?.trim()

  if (code === undefined && !params.has(TOKEN_HASH_PARAM)) {
    return undefined
  }

  history.replaceState(null, '', location.pathname + location.search)

  return code === undefined || code === '' ? undefined : code
}

/** Trades a code for the session cookie. A refusal sets the screen that explains it; the session
 *  load that follows still opens the page for a browser holding a good cookie. Rethrows an abort. */
export async function signInWithCode(code: string, abortSignal: AbortSignal): Promise<void> {
  try {
    await sendJson('POST', ROUTES.sessionExchange, { body: { code }, signal: abortSignal })
    noteCodeTraded()
  } catch (error: unknown) {
    if (!(error instanceof ApiFailure)) {
      throw error
    }

    authState.value = toRefusedState(error.status)
  }
}

/** Signs this browser out. The socket the daemon closes meanwhile reads as this sign-out, never as
 *  an ended session. */
export async function signOutThisBrowser(abortSignal: AbortSignal): Promise<void> {
  noteSigningOut()

  try {
    await sendJson('POST', ROUTES.sessionLogout, { signal: abortSignal })
    authState.value = 'signed-out'
  } finally {
    noteSignOutSettled()
  }
}

function toRefusedState(status: number): 'code-refused' | 'locked' | 'sign-in-failed' {
  if (status === UNAUTHORIZED_STATUS) {
    return 'code-refused'
  }

  return status === LOCKED_STATUS ? 'locked' : 'sign-in-failed'
}
