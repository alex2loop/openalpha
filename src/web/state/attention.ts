import { computed, effect, type ReadonlySignal, signal } from '@preact/signals'

import type { WireEvent } from '@/app/server/wire/events'
import { pluralKey } from '@/i18n'
import { unread as chatUnread, isChatOpen } from '@/web/state/chat'
import { ringChime, startChime } from '@/web/state/chime'
import { onWireEvent } from '@/web/state/events'
import { needsYou } from '@/web/state/notices'
import { notify } from '@/web/state/prefs'
import { brand } from '@/web/state/session'
import { tr } from '@/web/text/tr'

/** How long a `sneak` event brightens its person's bubble. */
const BRIGHT_MS = 3_000
// One per person at most is ever worth keeping: the roster's size, with the team floor's.
const MAX_BRIGHT = 32
/** Notifications already shown, by event key, so a replayed event never shows twice. */
const MAX_NOTIFIED = 200
const FAVICON_PX = 32
const FAVICON_DOT_TOKEN = '--badgeStop'
const FAVICON_TYPE = 'image/png'
const URGENT_KINDS: ReadonlySet<WireEvent['kind']> = new Set([
  'approval_requested',
  'stop_breached',
])
// Each weight adds to the one below it; the daemon assigns it and the page never re-derives it.
const WEIGHT_RANK = Object.freeze({
  quiet: 0,
  sneak: 1,
  nudge: 2,
  interrupt: 3,
} as const satisfies Record<WireEvent['weight'], number>)

/** A person an event just named: by its run, or by the own agent it came from. `untilMs` is a
 *  `performance.now()` instant. */
interface Brightened {
  readonly runId?: string
  readonly agentId?: string
  readonly untilMs: number
}

const brightList = signal<readonly Brightened[]>([])

/** The people whose bubble brightens now; the overlay drops each once its time is up. */
export const brightened: ReadonlySignal<readonly Brightened[]> = brightList
/** The tab's title: the count that needs the operator while there is one, else the product name. */
export const pageTitle = computed(() => {
  const count = needsYou.value

  if (brand.value === undefined || count === 0) {
    return brand.value
  }

  return tr(pluralKey(count, 'ui.office.title.needOne', 'ui.office.title.need'), { count })
})

/** Applies every wire event's `weight` while the feed runs, and keeps the favicon dot. The returned
 *  stop releases the listener, the chime's audio, the favicon and what was remembered. */
export function startAttention(): () => void {
  const notified = new Set<string>()
  const offEvents = onWireEvent('any', (event) => applyWeight(event, notified))
  const stopChime = startChime()
  const stopFavicon = startFavicon()

  return () => {
    offEvents()
    stopChime()
    stopFavicon()
    notified.clear()
    brightList.value = []
  }
}

/** The sentence for an approval request or a broken stop; absent for every other kind. */
export function urgentTextOf(event: WireEvent): string | undefined {
  if (event.kind === 'approval_requested' && event.approval !== undefined) {
    return tr('ui.office.a11y.newApproval', { what: event.approval.label })
  }

  if (event.kind === 'stop_breached' && event.alert !== undefined) {
    return tr('ui.office.a11y.breach', { ticker: event.alert.instrument.ticker })
  }

  return undefined
}

/** False when this browser has no notifications or the operator blocked them for the page. */
export function canNotify(): boolean {
  return 'Notification' in window && Notification.permission !== 'denied'
}

/** Asks for permission, only from the operator's click; true once it is granted. */
export async function askNotifyPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    return false
  }

  if (Notification.permission === 'granted') {
    return true
  }

  return (await Notification.requestPermission().catch(() => 'denied')) === 'granted'
}

function applyWeight(event: WireEvent, notified: Set<string>): void {
  const rank = WEIGHT_RANK[event.weight] ?? WEIGHT_RANK.quiet

  if (rank >= WEIGHT_RANK.sneak) {
    brighten(event)
  }

  if (rank >= WEIGHT_RANK.nudge && !isChatOpen.value) {
    chatUnread.value = true
  }

  if (rank < WEIGHT_RANK.interrupt) {
    return
  }

  if (URGENT_KINDS.has(event.kind)) {
    ringChime()
  }

  showNotification(event, notified)
}

function brighten(event: WireEvent): void {
  const agentId = event.source.agentId === '' ? undefined : event.source.agentId

  if (event.runId === undefined && agentId === undefined) {
    return
  }

  const entry: Brightened = {
    ...(event.runId === undefined ? {} : { runId: event.runId }),
    ...(agentId === undefined ? {} : { agentId }),
    untilMs: performance.now() + BRIGHT_MS,
  }
  const live = brightList.value.filter((held) => held.untilMs > performance.now())

  brightList.value = [...live, entry].slice(-MAX_BRIGHT)
}

// One per event key, only when the operator turned them on and the browser allows them.
function showNotification(event: WireEvent, notified: Set<string>): void {
  const key = notifyKeyOf(event)
  const body = urgentTextOf(event) ?? event.note ?? event.clarification?.text

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
  return 'Notification' in window && Notification.permission === 'granted'
}

function notifyKeyOf(event: WireEvent): string {
  const id = event.requestId ?? event.alert?.alertId ?? event.runId ?? event.note ?? ''

  return `${event.kind}:${id}`
}

// While something needs the operator the tab's icon is a dot, drawn here and swapped in as an
// object URL; every swap and the stop revoke the one before.
function startFavicon(): () => void {
  const link = document.createElement('link')
  const held: { url: string | undefined; isShown: boolean | undefined; isStopped: boolean } = {
    url: undefined,
    isShown: undefined,
    isStopped: false,
  }
  const revoke = (): void => {
    if (held.url !== undefined) {
      URL.revokeObjectURL(held.url)
      held.url = undefined
    }
  }
  const stopSync = effect(() => {
    const isNeeded = needsYou.value > 0

    if (isNeeded === held.isShown) {
      return
    }

    held.isShown = isNeeded
    link.remove()
    revoke()

    if (isNeeded) {
      drawDot((blob) => {
        if (held.isStopped || held.isShown !== true) {
          return
        }

        revoke()
        held.url = URL.createObjectURL(blob)
        link.rel = 'icon'
        link.href = held.url
        document.head.append(link)
      })
    }
  })

  return () => {
    held.isStopped = true
    stopSync()
    link.remove()
    revoke()
  }
}

function drawDot(onDrawn: (blob: Blob) => void): void {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  const half = FAVICON_PX / 2

  if (context === null) {
    return
  }

  canvas.width = FAVICON_PX
  canvas.height = FAVICON_PX
  context.fillStyle = getComputedStyle(document.documentElement)
    .getPropertyValue(FAVICON_DOT_TOKEN)
    .trim()
  context.beginPath()
  context.arc(half, half, half, 0, 2 * Math.PI)
  context.fill()
  canvas.toBlob((blob) => (blob === null ? undefined : onDrawn(blob)), FAVICON_TYPE)
}
