import { computed, type ReadonlySignal, signal } from '@preact/signals'

import type { CredentialsResponse, CredentialWriteBody } from '@/app/server/wire/credentials'
import type { ChatgptAuthStatus } from '@/app/server/wire/sign-in'
import { ApiFailure, getJson, sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { state } from '@/web/state/session'
import { noteRestartRow } from '@/web/state/settings'

/** How often the sign-in dialog asks whether the device code was entered. */
const CHATGPT_POLL_MS = 2_000
/** A minute past the daemon's own 15-minute sign-in timeout, so the daemon says how it ended. */
const CHATGPT_WAIT_MS = 16 * 60_000
const CONFLICT_CODE = 'conflict'
const DEVICE_LOGIN = Object.freeze({ method: 'device' })

export type Credential = CredentialsResponse['credentials'][number]

// A 409 on a key write: the daemon runs behind `public_url` though the page loaded before it did.
const refusedAsExposed = signal(false)
// Providers picked in "+ Thêm nhà cung cấp" this visit, shown before any key or model names them.
const picked = signal<readonly string[]>([])

/** Keys change only on the server: the booted `public_url`, or a write the daemon refused for it. */
export const isServerOnly: ReadonlySignal<boolean> = computed(
  () => state.value?.exposed === true || refusedAsExposed.value
)

export const pickedProviders: ReadonlySignal<readonly string[]> = picked

/** Throws `ApiFailure`. */
export function readCredentials(abort: AbortSignal): Promise<CredentialsResponse> {
  return getJson(ROUTES.credentials, { signal: abort })
}

/** Saves the key on the server; the daemon reads it after a restart. Throws `ApiFailure`. */
export async function saveCredential(
  name: string,
  value: string,
  abort: AbortSignal
): Promise<void> {
  await noteExposedRefusal(
    sendJson('POST', ROUTES.credentialWrite(name), {
      body: { value } satisfies CredentialWriteBody,
      signal: abort,
    })
  )
  noteRestartRow('credentials')
}

/** Takes the key out of the key file; what needs it stops after a restart. Throws `ApiFailure`. */
export async function removeCredential(name: string, abort: AbortSignal): Promise<void> {
  const { removed } = await noteExposedRefusal(
    sendJson('DELETE', ROUTES.credentialRemove(name), { signal: abort })
  )

  if (removed) {
    noteRestartRow('credentials')
  }
}

/** One group's variables by the venue, source or provider that reads them, in the daemon's order. */
export function groupBySubject(
  credentials: readonly Credential[],
  group: Credential['group']
): readonly (readonly [string, readonly Credential[]])[] {
  const bySubject = new Map<string, readonly Credential[]>()

  for (const credential of credentials) {
    if (credential.group === group) {
      bySubject.set(credential.subject, [...(bySubject.get(credential.subject) ?? []), credential])
    }
  }

  return [...bySubject]
}

export function pickProvider(provider: string): void {
  if (!picked.value.includes(provider)) {
    picked.value = [...picked.value, provider]
  }
}

/** Throws `ApiFailure`. */
export function readChatgpt(abort: AbortSignal): Promise<ChatgptAuthStatus> {
  return getJson(ROUTES.chatgpt, { signal: abort })
}

/** Signs out, and stops a sign-in still running on the daemon. Throws `ApiFailure`. */
export async function signOutChatgpt(): Promise<void> {
  await sendJson('DELETE', ROUTES.chatgpt)
}

interface SignInWatch {
  /** Every status read, the last one included. */
  readonly onStatus: (status: ChatgptAuthStatus) => void
  /** The start or a read failed, or `CHATGPT_WAIT_MS` passed; nothing is retried. */
  readonly onFailure: (error: unknown) => void
}

/** Starts the device sign-in, then reads its status every `CHATGPT_POLL_MS` in one timer chain
 *  until it ends. Returns the stop, which leaves the daemon's sign-in running: a DELETE would also
 *  sign out an account already signed in. */
export function watchChatgptSignIn(watch: SignInWatch): () => void {
  const controller = new AbortController()
  const startedAt = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = (): void => {
    clearTimeout(timer)
    controller.abort()
  }
  const fail = (error: unknown): void => {
    if (!controller.signal.aborted) {
      stop()
      watch.onFailure(error)
    }
  }
  const next = (status: ChatgptAuthStatus): void => {
    if (controller.signal.aborted) {
      return
    }

    watch.onStatus(status)

    if (isSignInOver(status)) {
      stop()
    } else if (performance.now() - startedAt >= CHATGPT_WAIT_MS) {
      fail(new ApiFailure(0, 'timeout'))
    } else {
      timer = setTimeout(poll, CHATGPT_POLL_MS)
    }
  }
  const poll = (): void => {
    readChatgpt(controller.signal).then(next, fail)
  }

  noteExposedRefusal(
    sendJson('POST', ROUTES.chatgpt, { body: DEVICE_LOGIN, signal: controller.signal })
  ).then(next, fail)

  return stop
}

/** The daemon drops the sign-in once it saved the account; a failed one stays until replaced. */
function isSignInOver(status: ChatgptAuthStatus): boolean {
  return status.login === undefined || status.login.state === 'failed'
}

async function noteExposedRefusal<T>(request: Promise<T>): Promise<T> {
  try {
    return await request
  } catch (error: unknown) {
    if (error instanceof ApiFailure && error.code === CONFLICT_CODE) {
      refusedAsExposed.value = true
    }

    throw error
  }
}
