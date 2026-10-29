import {
  authState,
  noteCodeTraded,
  noteSigningOut,
  noteSignOutSettled,
  refusalMessage,
} from '@/web/api/auth-state'
import {
  ApiFailure,
  NO_STATUS,
  SERVER_ERROR_STATUS,
  sendJson,
  UNAUTHORIZED_STATUS,
} from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'

const CODE_HASH_PARAM = 'code'
const TOKEN_HASH_PARAM = 'token'

/** The `#code=` of a sign-in link. The code stays in the address until `signInWithCode` has an
 *  answer, so a load that got none can be tried again; the address then drops it without a history
 *  entry, so neither the address bar nor the back button keeps it. A `#token=` is dropped at once,
 *  never read or sent: the page never holds the API token. */
export function readCodeFromHash(): string | undefined {
  const params = new URLSearchParams(location.hash.slice(1))
  const code = params.get(CODE_HASH_PARAM)?.trim()

  if (code === undefined || code === '') {
    if (params.has(CODE_HASH_PARAM) || params.has(TOKEN_HASH_PARAM)) {
      replaceHash('')
    }

    return undefined
  }

  if (params.has(TOKEN_HASH_PARAM)) {
    replaceHash(`#${CODE_HASH_PARAM}=${encodeURIComponent(code)}`)
  }

  return code
}

/** Trades a code for the session cookie; true once the daemon has answered, false when no answer
 *  came (nothing reached it, or a server error), so the code is still unspent. A refusal sets the screen that explains it; the session load
 *  that follows still opens the page for a browser holding a good cookie. Rethrows an abort. */
export async function signInWithCode(code: string, abortSignal: AbortSignal): Promise<boolean> {
  try {
    await sendJson('POST', ROUTES.sessionExchange, { body: { code }, signal: abortSignal })
    noteCodeTraded()
  } catch (error: unknown) {
    if (!(error instanceof ApiFailure)) {
      throw error
    }

    // A restarting daemon behind a proxy answers 502 to 504: no answer from the daemon itself.
    if (error.status === NO_STATUS || error.status >= SERVER_ERROR_STATUS) {
      return false
    }

    authState.value = toRefusedState(error)
    refusalMessage.value = authState.value === 'sign-in-failed' ? error.message : ''
  }

  replaceHash('')

  return true
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

function replaceHash(hash: string): void {
  history.replaceState(null, '', location.pathname + location.search + hash)
}

// The lockout is told by its error code `locked`; a Host, Origin or proxy refusal either never
// reaches the exchange or names its cause in `message`.
function toRefusedState(failure: ApiFailure): 'code-refused' | 'locked' | 'sign-in-failed' {
  if (failure.status === UNAUTHORIZED_STATUS) {
    return 'code-refused'
  }

  return failure.code === 'locked' ? 'locked' : 'sign-in-failed'
}
