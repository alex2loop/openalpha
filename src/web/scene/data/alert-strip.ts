import { computed, type ReadonlySignal } from '@preact/signals'

import type { NoticeWire } from '@/app/server/wire/notices'
import { notices } from '@/web/state/notices'
import { toNoticeText } from '@/web/text/notice'

/** How a headline on the strip reads: a breached stop, a fired alert, anything else. */
export type StripTone = 'problem' | 'caution' | 'plain'

interface StripLine {
  readonly title: string
  readonly tone: StripTone
}

/** The LED strip over the alert desk: the notices still unread, else the newest one held still;
 *  `sig` changes exactly when what it shows does. */
export interface AlertStrip {
  readonly sig: string
  readonly lines: readonly StripLine[]
  readonly isNew: boolean
}

/** What the alert desk's strip shows, from the bell's own notices. */
export const alertStrip: ReadonlySignal<AlertStrip> = computed(() => {
  const unread = notices.value.filter((notice) => notice.readAt === undefined)
  const shown = unread.length > 0 ? unread : notices.value.slice(0, 1)
  const lines = shown.flatMap(toLine)

  return {
    sig: [unread.length > 0, ...lines.map((line) => `${line.tone}:${line.title}`)].join('|'),
    lines,
    isNew: unread.length > 0,
  }
})

function toLine(notice: NoticeWire): readonly StripLine[] {
  const title = toNoticeText(notice.event)?.title

  return title === undefined || title === '' ? [] : [{ title, tone: toneOf(notice) }]
}

function toneOf(notice: NoticeWire): StripTone {
  if (notice.event.kind === 'stop_breached') {
    return 'problem'
  }

  return notice.event.kind === 'alert_fired' ? 'caution' : 'plain'
}
