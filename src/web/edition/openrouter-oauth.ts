import { readStorage, removeStorage, writeStorage } from '@/web/state/storage'

const AUTH_URL = 'https://openrouter.ai/auth'
const EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys'
const VERIFIER_KEY = 'oa.oauth.verifier'
const STATE_KEY = 'oa.oauth.state'
const VERIFIER_BYTES = 48
const STATE_BYTES = 16
/** The most the page waits for OpenRouter to trade the code for a key. */
const EXCHANGE_TIMEOUT_MS = 15_000
const CHALLENGE_METHOD = 'S256'
const CODE_PARAM = 'code'
const STATE_PARAM = 'state'

/** OpenRouter's PKCE flow: the visitor signs in at OpenRouter, which sends the page back with a
 *  one-time `code`; the page trades it, with the verifier it kept, for a key of the visitor's own.
 *  The exchange endpoint answers cross-origin calls, so no server of ours is involved. */
export async function beginOpenRouterConnect(): Promise<void> {
  const verifier = randomToken(VERIFIER_BYTES)
  const state = randomToken(STATE_BYTES)

  writeStorage('session', VERIFIER_KEY, verifier)
  writeStorage('session', STATE_KEY, state)

  const query = new URLSearchParams({
    callback_url: `${location.origin}${location.pathname}`,
    code_challenge: await challengeOf(verifier),
    code_challenge_method: CHALLENGE_METHOD,
    state,
  })

  location.assign(`${AUTH_URL}?${query}`)
}

/** The outcome of a page load that OpenRouter sent the visitor back to. */
export type ConnectResult = { readonly key: string } | { readonly failed: true }

/** Reads a callback out of the address, once, and leaves the address clean. Absent when this page
 *  load is not one. */
export async function finishOpenRouterConnect(
  signal: AbortSignal
): Promise<ConnectResult | undefined> {
  const params = new URLSearchParams(location.search)
  const code = params.get(CODE_PARAM)

  if (code === null) {
    return undefined
  }

  const verifier = readStorage('session', VERIFIER_KEY)
  const expected = readStorage('session', STATE_KEY)
  const returned = params.get(STATE_PARAM)

  removeStorage('session', VERIFIER_KEY)
  removeStorage('session', STATE_KEY)

  params.delete(CODE_PARAM)
  params.delete(STATE_PARAM)
  history.replaceState(
    null,
    '',
    `${location.pathname}${params.size > 0 ? `?${params}` : ''}${location.hash}`
  )

  if (verifier === undefined || returned !== expected) {
    return { failed: true }
  }

  const key = await exchange(code, verifier, signal)

  return key === undefined ? { failed: true } : { key }
}

async function exchange(
  code: string,
  verifier: string,
  signal: AbortSignal
): Promise<string | undefined> {
  try {
    const response = await fetch(EXCHANGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        code_challenge_method: CHALLENGE_METHOD,
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(EXCHANGE_TIMEOUT_MS)]),
    })
    const body: unknown = response.ok ? await response.json() : undefined

    if (
      typeof body === 'object' &&
      body !== null &&
      'key' in body &&
      typeof body.key === 'string'
    ) {
      return body.key
    }

    return undefined
  } catch {
    return undefined
  }
}

async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))

  return toBase64Url(new Uint8Array(digest))
}

function randomToken(bytes: number): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}
