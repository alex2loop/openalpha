import { effect, type ReadonlySignal, signal } from '@preact/signals'

import type { NoticeWire } from '@/app/server/wire/notices'
import type { RestartBody } from '@/app/server/wire/system'
import type { RestartWhen } from '@/app/server/wire/vocab'
import { sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { onWireEvent } from '@/web/state/events'
import { notices } from '@/web/state/notices'
import { state } from '@/web/state/session'
import { clearRestartRows, pendingRestart, type RestartRow } from '@/web/state/settings'

/** Boot and reconnect: the one wait the page owns, because the daemon cannot report its own boot
 *  time. The idle wait and the drain come from `/v1/state`. */
const RESTART_BOOT_MS = 60_000
// The daemon's clock and this page's may differ a little; a notice older than this is not ours.
const CLOCK_SKEW_MS = 300_000
const DONE = 'restart-done'
const FAILED = 'restart-failed'

/** `waiting` from the daemon's answer until its notice; `timedOut` when none came in time, which a
 *  late `restart-done` still turns into `done`. */
type RestartPhase =
  | { readonly kind: 'waiting'; readonly refusedApprovals: number; readonly applied: AppliedRows }
  | { readonly kind: 'done'; readonly note: string; readonly applied: AppliedRows }
  | { readonly kind: 'failed'; readonly note: string; readonly applied: AppliedRows }
  | { readonly kind: 'timedOut'; readonly applied: AppliedRows }

type AppliedRows = readonly RestartRow[]

const phase = signal<RestartPhase | undefined>(undefined)
// The one wait timer: cleared on every outcome and when the feed stops.
let waitTimer: ReturnType<typeof setTimeout> | undefined
// The bell's rows when the restart began and the time it was asked: a restart notice not among
// them, and not older, is this restart's.
let knownNoticeIds: ReadonlySet<string> = new Set()
let requestedAt = 0

/** The restart the page asked for, from the daemon's answer to what it did; absent when none. */
export const restartPhase: ReadonlySignal<RestartPhase | undefined> = phase

/** The longest the page waits for the daemon to come back: the wait for quiet (`idle` only), the
 *  grace runs in flight get, and the boot. */
function restartWaitMs(when: RestartWhen): number {
  const daemon = state.peek()
  const idleMs = when === 'idle' ? (daemon?.restartIdleWaitMs ?? 0) : 0

  return idleMs + (daemon?.restartDrainMs ?? 0) + RESTART_BOOT_MS
}

/** Asks the daemon to restart and starts the wait. Throws `ApiFailure` with the daemon's sentence
 *  when it refuses (a terminal, a restart already under way). */
export async function requestRestart(when: RestartWhen): Promise<void> {
  const body: RestartBody = { when }
  const answer = await sendJson('POST', ROUTES.restart, { body })

  knownNoticeIds = new Set(notices.peek().map((notice) => notice.id))
  requestedAt = Date.now()
  settle({
    kind: 'waiting',
    refusedApprovals: answer.refusedApprovals,
    applied: pendingRestart.peek(),
  })
  waitTimer = setTimeout(() => {
    settle({ kind: 'timedOut', applied: pendingRestart.peek() })
  }, restartWaitMs(when))
}

/** Forgets the restart: the wait ends and the line goes. Idempotent. */
export function dismissRestart(): void {
  clearTimeout(waitTimer)
  waitTimer = undefined
  phase.value = undefined
}

/** Listens for the daemon's own restart notice, live and in the bell (a socket that was down when
 *  it came still finds it there). The returned stop is idempotent. */
export function startRestartWatch(): () => void {
  const off = onWireEvent('daemon_notice', (event) => {
    noteRestartNotice(event.noticeKind, event.note ?? '')
  })
  const stopBell = effect(() => {
    watchBell(notices.value)
  })

  return () => {
    off()
    stopBell()
    dismissRestart()
  }
}

function watchBell(rows: readonly NoticeWire[]): void {
  const current = phase.peek()

  if (current === undefined || current.kind === 'done' || current.kind === 'failed') {
    return
  }

  const fresh = rows.find(
    (row) =>
      row.event.kind === 'daemon_notice' &&
      !knownNoticeIds.has(row.id) &&
      row.createdAt >= requestedAt - CLOCK_SKEW_MS &&
      (row.event.noticeKind === DONE || row.event.noticeKind === FAILED)
  )

  if (fresh !== undefined) {
    noteRestartNotice(fresh.event.noticeKind, fresh.event.note ?? '')
  }
}

function noteRestartNotice(kind: string | undefined, note: string): void {
  const applied = phase.peek()?.applied ?? pendingRestart.peek()

  if (kind === DONE) {
    clearRestartRows()

    if (phase.peek() !== undefined) {
      settle({ kind: 'done', note, applied })
    }
  } else if (kind === FAILED && phase.peek() !== undefined) {
    settle({ kind: 'failed', note, applied })
  }
}

// Every outcome ends the wait, so the timer is cleared before the phase changes.
function settle(next: RestartPhase): void {
  clearTimeout(waitTimer)
  waitTimer = undefined
  phase.value = next
}
