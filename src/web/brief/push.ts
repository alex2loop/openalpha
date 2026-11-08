import type { Locale } from '@/web/brief/strings'
import { LATEST_CACHE, PUSH_LOCALE_KEY, withFetchDeadline } from '@/web/brief/load'

const SUBSCRIBE_PATH = '/api/subscribe'
const UNSUBSCRIBE_PATH = '/api/unsubscribe'
const STANDALONE_QUERY = '(display-mode: standalone)'
const FULL_STATUS = 503
// The calls below end with their own deadline; no caller of theirs has anything to abort.
const NEVER_ABORTED = new AbortController().signal

/** The public half of the Worker's VAPID key, which the build stamps in; empty when the build
 *  carries no reminder. */
declare const VAPID_PUBLIC_KEY: string

export type ReminderAnswer = 'on' | 'denied' | 'full' | 'failed'

/** What this phone can do about reminders: push, only from the installed app, or nothing. */
export function reminderSupport(): 'push' | 'install-first' | 'none' {
  if (VAPID_PUBLIC_KEY === '') {
    return 'none'
  }

  if (!matchMedia(STANDALONE_QUERY).matches) {
    return 'install-first'
  }

  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    ? 'push'
    : 'none'
}

/** Whether reminders are on: the phone allows them and holds a subscription made under this build's
 *  key. One made under another key (the Worker's key was rotated) is dropped. */
export async function readReminder(): Promise<boolean> {
  if (Notification.permission !== 'granted') {
    return false
  }

  const subscription = await currentSubscription()

  if (subscription === undefined) {
    return false
  }

  if (isOwnKey(subscription.options.applicationServerKey)) {
    return true
  }

  await subscription.unsubscribe()

  return false
}

/** Asks the phone's permission (first, so a tap's gesture still counts), subscribes, and hands the
 *  push address to the Worker. A subscription this call made is dropped again unless the Worker
 *  took it; one the phone already held is dropped only when the Worker has no room for it, so a
 *  bad connection never ends a working reminder. */
export async function subscribePush(): Promise<ReminderAnswer> {
  if ((await Notification.requestPermission()) !== 'granted') {
    return 'denied'
  }

  const held = await currentSubscription().catch(() => undefined)
  const subscription = held ?? (await createSubscription().catch(() => undefined))

  if (subscription === undefined) {
    return 'failed'
  }

  const answer = await sendSubscription(subscription.endpoint).catch(() => 'failed' as const)

  if (answer === 'full' || (answer !== 'on' && held === undefined)) {
    await subscription.unsubscribe().catch(() => false)
  }

  return answer
}

/** Turns reminders off here first, so they stop even when the Worker cannot be reached. */
export async function unsubscribePush(): Promise<void> {
  const subscription = await currentSubscription()

  if (subscription === undefined) {
    return
  }

  const { endpoint } = subscription

  await subscription.unsubscribe()

  // A lost request leaves the Worker's copy, which it drops when the push service refuses it.
  await withFetchDeadline(NEVER_ABORTED, (signal) =>
    postEndpoint(UNSUBSCRIBE_PATH, endpoint, signal)
  ).catch(() => undefined)
}

/** Keeps the reader's language where the service worker reads it when a push arrives. Never
 *  rejects: a push without it comes in the phone's own language. */
export async function keepPushLocale(locale: Locale): Promise<void> {
  try {
    await (await caches.open(LATEST_CACHE)).put(PUSH_LOCALE_KEY, new Response(locale))
  } catch {
    // A full cache or blocked site data keeps nothing.
  }
}

function registrationOf(): Promise<ServiceWorkerRegistration | undefined> {
  return navigator.serviceWorker.getRegistration()
}

async function currentSubscription(): Promise<PushSubscription | undefined> {
  return (await (await registrationOf())?.pushManager.getSubscription()) ?? undefined
}

async function createSubscription(): Promise<PushSubscription | undefined> {
  return await (await registrationOf())?.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(),
  })
}

async function sendSubscription(endpoint: string): Promise<ReminderAnswer> {
  return await withFetchDeadline(NEVER_ABORTED, async (signal) => {
    const response = await postEndpoint(SUBSCRIBE_PATH, endpoint, signal)

    if (response.ok) {
      return 'on'
    }

    return (await isFull(response)) ? 'full' : 'failed'
  })
}

function postEndpoint(path: string, endpoint: string, signal: AbortSignal): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
    signal,
  })
}

async function isFull(response: Response): Promise<boolean> {
  const body: unknown = await response.json().catch(() => undefined)

  return (
    response.status === FULL_STATUS &&
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    body.error === 'full'
  )
}

function isOwnKey(held: ArrayBuffer | null): boolean {
  const own = keyBytes()
  const bytes = new Uint8Array(held ?? new ArrayBuffer(0))

  return bytes.length === own.length && bytes.every((byte, index) => byte === own[index])
}

function keyBytes(): Uint8Array<ArrayBuffer> {
  const standard = VAPID_PUBLIC_KEY.replaceAll('-', '+').replaceAll('_', '/')

  return Uint8Array.from(atob(standard), (char) => char.charCodeAt(0))
}
