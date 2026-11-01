import type { WireEvent } from '@/app/server/wire/events'
import { notify } from '@/web/state/prefs'
import { brand } from '@/web/state/session'

/** Notifications already shown, by event key, so a replayed event never shows twice. */
const MAX_NOTIFIED = 200

/** False when this browser has no notifications or the operator blocked them for the page. */
export function canNotify(): boolean {
  return hasNotifications() && Notification.permission !== 'denied'
}

/** Asks for permission, only from the operator's click; true once it is granted. */
export async function askNotifyPermission(): Promise<boolean> {
  if (!hasNotifications()) {
    return false
  }

  if (Notification.permission === 'granted') {
    return true
  }

  return (await Notification.requestPermission().catch(() => 'denied')) === 'granted'
}

/** One per event key, only when the operator turned them on and the browser allows them. */
export function showNotification(
  event: WireEvent,
  body: string | undefined,
  notified: Set<string>
): void {
  const key = notifyKeyOf(event)

  if (!(notify.value && isGranted()) || notified.has(key) || body === undefined) {
    return
  }

  notified.add(key)

  for (const oldest of notified) {
    if (notified.size <= MAX_NOTIFIED) {
      break
    }

    notified.delete(oldest)
  }

  try {
    const shown = new Notification(brand.value ?? '', { body, tag: key })

    shown.addEventListener('click', () => {
      window.focus()
      shown.close()
    })
  } catch {
    // A browser that allows notifications only from a service worker shows none; the bell has it.
  }
}

function isGranted(): boolean {
  return hasNotifications() && Notification.permission === 'granted'
}

function notifyKeyOf(event: WireEvent): string {
  const id = event.requestId ?? event.alert?.alertId ?? event.runId ?? event.note ?? ''

  return `${event.kind}:${id}`
}

function hasNotifications(): boolean {
  return 'Notification' in window
}
