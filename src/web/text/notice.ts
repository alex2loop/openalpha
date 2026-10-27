import type { WireEvent } from '@/app/server/wire/events'
import { sourceLabel } from '@/web/text/source'
import { tr } from '@/web/text/tr'
import { parseReport, plainTextOf } from '@/web/ui/markdown/parse'

const LINE_BREAK = '\n'

interface NoticeText {
  readonly title: string
  readonly detail?: string
}

/** A notice as the bell words it: its first line, then the rest. */
export function toNoticeText(event: WireEvent): NoticeText | undefined {
  // A scheduled answer arrives as markdown; the bell shows its words, not its marks.
  const note = event.note === undefined ? '' : plainTextOf(parseReport(event.note)).trim()

  if (note !== '') {
    const [title = '', ...rest] = note.split(LINE_BREAK)
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
