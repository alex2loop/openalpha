import type { WireEvent } from '@/app/server/wire/events'
import type { NoticeWire } from '@/app/server/wire/notices'
import { markRead } from '@/web/state/notices'
import { state } from '@/web/state/session'
import { sourceLabel } from '@/web/text/source'
import { formatClock } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { JOBS_POPOVER_ID } from '@/web/ui/jobs/jobs-popover'
import { Button } from '@/web/ui/kit/button'
import { togglePopover } from '@/web/ui/kit/popover'

const LINE_BREAK = '\n'

interface NoticeText {
  readonly title: string
  readonly detail?: string
}

/** One bell entry: its first line as the title, the rest below; read ones greyed. */
export function NoticeRow({ notice }: { readonly notice: NoticeWire }) {
  const text = toNoticeText(notice.event)
  const timeZone = state.value?.timeZone

  if (text === undefined) {
    return null
  }

  const classes = [
    'notice-row',
    notice.readAt === undefined ? 'is-unread' : '',
    notice.event.kind === 'stop_breached' ? 'is-stop' : '',
  ]

  return (
    <div class={classes.filter((name) => name !== '').join(' ')}>
      <i class="notice-dot" aria-hidden="true" />
      <div class="notice-main">
        <b>{text.title}</b>
        {text.detail !== undefined && <p class="meta notice-detail">{text.detail}</p>}
      </div>
      <div class="notice-side">
        {timeZone !== undefined && (
          <span class="meta">{formatClock(notice.createdAt, timeZone)}</span>
        )}
        <NoticeAction notice={notice} />
      </div>
    </div>
  )
}

// A scheduled result carries no job id, so its action opens the scheduled jobs.
function NoticeAction({ notice }: { readonly notice: NoticeWire }) {
  if (notice.event.kind !== 'schedule_result') {
    return null
  }

  function openJobs(): void {
    togglePopover(JOBS_POPOVER_ID)

    if (notice.readAt === undefined) {
      // A failed mark leaves the row unread; the bell's next read shows it as it stands.
      markRead([notice.id]).catch(() => undefined)
    }
  }

  return (
    <Button size="small" onClick={openJobs}>
      {tr('ui.office.bell.openJobs')}
    </Button>
  )
}

function toNoticeText(event: WireEvent): NoticeText | undefined {
  if (event.note !== undefined && event.note.trim() !== '') {
    const [title = '', ...rest] = event.note.trim().split(LINE_BREAK)
    const detail = rest.join(LINE_BREAK).trim()

    return detail === '' ? { title } : { title, detail }
  }

  if (event.approval !== undefined) {
    return { title: event.approval.label, detail: event.approval.argsSummary }
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
