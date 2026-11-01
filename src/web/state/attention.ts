import { computed, type ReadonlySignal, signal } from '@preact/signals'

import type { WireEvent } from '@/app/server/wire/events'
import { pluralKey } from '@/i18n'
import { unread as chatUnread, isChatOpen } from '@/web/state/chat'
import { ringChime, startChime } from '@/web/state/chime'
import { onWireEvent } from '@/web/state/events'
import { startFavicon } from '@/web/state/favicon'
import { needsYou } from '@/web/state/notices'
import { showNotification } from '@/web/state/notifications'
import { brand } from '@/web/state/session'
import { tr } from '@/web/text/tr'

/** How long a `sneak` event brightens its person's bubble. */
const BRIGHT_MS = 3_000
// One per person at most is ever worth keeping: the roster's size, with the team floor's.
const MAX_BRIGHT = 32
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

  showNotification(event, urgentTextOf(event) ?? event.note ?? event.clarification?.text, notified)
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
