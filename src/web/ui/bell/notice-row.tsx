import type { NoticeWire } from '@/app/server/wire/notices'
import { markRead } from '@/web/state/notices'
import { state } from '@/web/state/session'
import { toNoticeText } from '@/web/text/notice'
import { formatClock } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { JOBS_POPOVER_ID, togglePopover } from '@/web/ui/kit/popover'
import { LinkedText } from '@/web/ui/ticker/linked-text'

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
        <b>
          <LinkedText text={text.title} />
        </b>
        {text.detail !== undefined && (
          <p class="meta notice-detail">
            <LinkedText text={text.detail} />
          </p>
        )}
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
