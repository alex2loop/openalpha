import type { WireEvent } from '@/app/server/wire/events'
import { sourceLabel } from '@/web/text/source'
import { tr } from '@/web/text/tr'

const LINE_BREAK = '\n'

/** A notice's words: its first line as the title, the rest as detail. */
interface NoticeText {
  readonly title: string
  readonly detail?: string
}

/** A notice as the bell words it: its first line, then the rest. */
export function toNoticeText(event: WireEvent): NoticeText | undefined {
  if (event.note !== undefined && event.note.trim() !== '') {
    const [title = '', ...rest] = event.note.trim().split(LINE_BREAK)
    const detail = rest.join(LINE_BREAK).trim()

    return detail === '' ? { title } : { title, detail }
  }

  if (event.approval !== undefined) {
    const { label, argsSummary } = event.approval

    return argsSummary === '' ? { title: label } : { title: label, detail: argsSummary }
  }

  if (event.clarification !== undefined) {
    return { title: event.clarification.text }
  }

  if (event.pairing !== undefined) {
    return {
      title: tr('ui.office.bell.pairing', {
        channel: sourceLabel(event.pairing.channel),
        code: event.pairing.code,
      }),
    }
  }

  return undefined
}
