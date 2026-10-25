import { signal } from '@preact/signals'

import { readStorage, removeStorage, writeStorage } from '@/web/state/storage'

type AuthState = 'ok' | 'missing' | 'refused'

const TOKEN_STORAGE_KEY = 'office.token'
const TOKEN_HASH_PARAM = 'token'

// Holds the token for the tab's life when storage is blocked.
let memoryToken: string | undefined

/** `ok` until a session load finds no token (`missing`) or the daemon refuses it (`refused`). */
export const authState = signal<AuthState>('ok')

/** Moves a `#token=` link into session storage and drops the hash without a history entry, so
 *  neither the address bar nor the back button keeps the token. */
export function takeTokenFromHash(): void {
  const params = new URLSearchParams(location.hash.slice(1))
  const token = params.get(TOKEN_HASH_PARAM)?.trim()

  if (token === undefined) {
    return
  }

  history.replaceState(null, '', location.pathname + location.search)

  if (token !== '') {
    saveToken(token, { remember: false })
  }
}

export function saveToken(token: string, options: { readonly remember: boolean }): void {
  memoryToken = token
  writeStorage('session', TOKEN_STORAGE_KEY, token)

  if (options.remember) {
    writeStorage('local', TOKEN_STORAGE_KEY, token)
  }
}

export function readToken(): string | undefined {
  memoryToken ??=
    readStorage('session', TOKEN_STORAGE_KEY) ?? readStorage('local', TOKEN_STORAGE_KEY)

  return memoryToken
}

export function clearToken(): void {
  memoryToken = undefined
  removeStorage('session', TOKEN_STORAGE_KEY)
  removeStorage('local', TOKEN_STORAGE_KEY)
}
