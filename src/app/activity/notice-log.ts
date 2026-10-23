import { randomUUID } from 'node:crypto'

import type { WireEvent } from '@/app/server/wire/events'
import type { App } from '@/core/container'
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

/** Writes the bell: every wire event that is worth more than a flicker, in every process that boots
 *  the app, whether or not the api runs. The stored event is built by the same normalisers the
 *  sockets are sent, so a page that reads the log sees what a connected one saw. Weight `quiet` is
 *  not kept. Each write is followed by `notices_changed`, so a page refetches only once the row is
 *  there.
 *
 *  Writes run one after another, so the count each `notices_changed` carries is the one after its
 *  own write. The caller awaits `stop` before closing storage. */
export function startNoticeLog(app: App): NoticeLog {
  const bus = app.resolve('bus')
  const store = app.resolve('noticeStore')
  const logger = app.resolve('logger')
  const locale = app.config.locale.language
  let tail: Promise<void> = Promise.resolve()
  let failureLogged = false

  const persist = async (row: NoticeRow): Promise<void> => {
    try {
      await store.record(row)
      bus.emit('notices_changed', { unread: await store.unreadCount() })
    } catch (err: unknown) {
      if (!failureLogged) {
        failureLogged = true
        logger.warn('activity.notice_log_failed', { err: formatErrForLog(err) })
      }
    }
  }
  const file = (filing: Filing): void => {
    if (filing.event.weight !== 'quiet') {
      tail = tail.then(() => persist(toRow(filing)))
    }
  }
  const offs = [
    app.resolve('deliveredNotices')((message, channels) => {
      const event = toWireEvent(message)

      if (event !== undefined) {
        file({ event, deliveredTo: channels })
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
