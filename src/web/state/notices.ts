import { computed, type ReadonlySignal, signal } from '@preact/signals'

import type { NoticesResponse, NoticeWire } from '@/app/server/wire/notices'
import { ApiFailure, getJson, sendJson } from '@/web/api/client'
import { startPoll } from '@/web/api/poll'
import { ROUTES } from '@/web/api/routes'
import { createSingleFlight } from '@/web/api/single-flight'
import { onWireEvent } from '@/web/state/events'
import { pending, pendingRequestId } from '@/web/state/live'

/** The newest page of the bell the page holds; the bell does not page further. */
const MAX_NOTICES = 100
// A backstop for a `notices_changed` the socket missed while it was down.
const NOTICES_POLL_MS = 60_000

const page = signal<NoticesResponse | undefined>(undefined)
const failure = signal<ApiFailure | undefined>(undefined)

/** Newest first; empty until the first read. */
export const notices = computed<readonly NoticeWire[]>(() => page.value?.items ?? [])
/** Notices without `readAt`; absent until the first read. */
export const unread = computed(() => page.value?.unread)
/** Approvals waiting now plus unread stop breaches. */
export const needsYou = computed(() => page.value?.needsYou ?? 0)
/** Why the last read failed; cleared by the next good one. */
export const noticesFailure: ReadonlySignal<ApiFailure | undefined> = failure

const waitingIds = computed<ReadonlySet<string | undefined>>(
  () => new Set(pending.value.map(pendingRequestId))
)

/** Reads the bell now, again on every `notices_changed` (sent after the row is written, so the
 *  read finds it) and on every resolved approval (which leaves `needsYou`), and every
 *  `NOTICES_POLL_MS`. The returned stop is idempotent. */
export function startNotices(): () => void {
  const lifetime = new AbortController()
  const refetch = createSingleFlight(loadNotices, lifetime.signal)
  // `refetch` never rejects: `loadNotices` records its own failure.
  const onChange = (): void => {
    refetch().catch(() => undefined)
  }
  const offs = [
    onWireEvent('notices_changed', onChange),
    onWireEvent('approval_resolved', onChange),
  ]
  const stopPoll = startPoll(() => refetch(), NOTICES_POLL_MS)

  return () => {
    lifetime.abort()
    stopPoll()

    for (const off of offs) {
      off()
    }
  }
}

/** Marks the given notices read, or every unread one when `ids` is absent. Throws `ApiFailure`. */
export async function markRead(ids?: readonly string[]): Promise<void> {
  const answer = await sendJson('POST', ROUTES.noticesRead, {
    body: ids === undefined ? {} : { ids },
  })

  if (page.value !== undefined) {
    page.value = { ...page.value, unread: answer.unread }
  }
}

async function loadNotices(abortSignal: AbortSignal): Promise<void> {
  try {
    page.value = await getJson(ROUTES.notices, {
      query: { limit: MAX_NOTICES },
      signal: abortSignal,
    })
    failure.value = undefined
  } catch (error: unknown) {
    // Anything but an `ApiFailure` is the stop's own abort.
    if (error instanceof ApiFailure) {
      failure.value = error
    }
  }
}

/** The notice of a request still waiting: it shows as a card and counts in `needsYou`, not as a row. */
export function isWaitingNotice(notice: NoticeWire): boolean {
  const { requestId } = notice.event

  return requestId !== undefined && waitingIds.value.has(requestId)
}
