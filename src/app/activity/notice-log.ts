import { randomUUID } from 'node:crypto'

import type { WireEvent } from '@/app/server/wire/events'
import type { App } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { NoticeRow } from '@/persistence/api'
import '@/app/events'
import { toBudgetNote } from '@/app/server/feed/budget'
import { toFillNote } from '@/app/server/feed/fills'
import { toWireEvent } from '@/app/server/push/notice-event'
import { NOTED_NORMALIZERS, toApprovalWire, WIRE_NORMALIZERS } from '@/app/server/ws/wire-events'
import { formatErrForLog } from '@/core/security/credentials'

export interface NoticeLog {
  /** Stops listening, then waits for every write already begun. Safe to call twice. */
  stop(): Promise<void>
}

/** A notice's wire event, and where else it went. */
interface Filing {
  readonly event: WireEvent
  readonly deliveredTo: readonly string[]
  readonly createdAt?: number
}

/** Writes the bell: every non-`quiet` wire event, in every process that boots the app, whether or not
 *  the api runs, built by the same normalisers the sockets are sent. Writes run one after another and
 *  each is followed by `notices_changed`, so the count it carries is the one after its own write.
 *  The caller awaits `stop` before closing storage. */
export function startNoticeLog(app: App): NoticeLog {
  const bus = app.resolve('bus')
  const store = app.resolve('noticeStore')
  const logger = app.resolve('logger')
  const locale = app.config.locale.language
  let tail: Promise<void> = Promise.resolve()
  const logFailure = createFailureLog(logger)

  const persist = async (row: NoticeRow): Promise<void> => {
    try {
      await store.record(row)
      bus.emit('notices_changed', { unread: await store.unreadCount() })
    } catch (err: unknown) {
      logFailure(err)
    }
  }
  const file = (filing: Filing): void => {
    if (filing.event.weight !== 'quiet') {
      tail = tail.then(() => persist(toRow(filing)))
    }
  }
  const offs = [
    app.resolve('deliveredNotices')((message, channels) => {
      try {
        const event = toWireEvent(message)

        if (event !== undefined) {
          file({ event, deliveredTo: channels })
        }
      } catch (err: unknown) {
        logFailure(err)
      }
    }),
    ...followBus(app, { file, locale }),
  ]

  return {
    stop: async () => {
      for (const off of offs) {
        off()
      }

      await tail
    },
  }
}

// A store that is down fails every notice; the first failure says so and the rest stay quiet.
function createFailureLog(logger: Logger): (err: unknown) => void {
  let failureLogged = false

  return (err) => {
    if (!failureLogged) {
      failureLogged = true
      logger.warn('activity.notice_log_failed', { err: formatErrForLog(err) })
    }
  }
}

interface BusFollow {
  readonly file: (filing: Filing) => void
  readonly locale: Locale
}

// A request raised in a chat reached that chat too; the rest are the bell's own.
function followBus(app: App, { file, locale }: BusFollow): (() => void)[] {
  const bus = app.resolve('bus')
  const asked = (e: { readonly channel: string }): readonly string[] => [e.channel]

  return [
    bus.on('approval_requested', (e) =>
      file({ event: toApprovalWire(e, locale), deliveredTo: asked(e) })
    ),
    bus.on('clarification_requested', (e) =>
      file({ event: WIRE_NORMALIZERS.clarification_requested(e), deliveredTo: asked(e) })
    ),
    bus.on('pairing_requested', (e) =>
      file({ event: WIRE_NORMALIZERS.pairing_requested(e), deliveredTo: asked(e) })
    ),
    bus.on('budget_exhausted', (e) =>
      file({
        event: NOTED_NORMALIZERS.budget_exhausted(e, toBudgetNote(e, locale)),
        deliveredTo: [],
      })
    ),
    bus.on('order_filled', (e) =>
      file({
        event: NOTED_NORMALIZERS.order_filled(e, toFillNote(e, locale)),
        deliveredTo: [],
      })
    ),
    bus.on('daemon_notice', (e) =>
      file({ event: WIRE_NORMALIZERS.daemon_notice(e), deliveredTo: [], createdAt: e.at })
    ),
  ]
}

function toRow({ event, deliveredTo, createdAt }: Filing): NoticeRow {
  return {
    id: randomUUID(),
    kind: event.kind,
    weight: event.weight,
    wake: event.wake === true,
    ...(event.runId === undefined ? {} : { runId: event.runId }),
    deliveredTo,
    event: JSON.stringify(event),
    createdAt: createdAt ?? Date.now(),
  }
}
