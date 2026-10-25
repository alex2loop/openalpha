import type { RefObject } from 'preact'
import { useSignal } from '@preact/signals'

import type { NoticeWire } from '@/app/server/wire/notices'
import { pluralKey } from '@/i18n'
import { ApiFailure } from '@/web/api/client'
import { pending, pendingRequestId } from '@/web/state/live'
import { markRead, notices, noticesFailure, unread } from '@/web/state/notices'
import { state } from '@/web/state/session'
import { buildDayKey } from '@/web/text/time'
import { toFailureText, tr } from '@/web/text/tr'
import { openActivityDialog } from '@/web/ui/activity/activity-dialog'
import { PendingCard } from '@/web/ui/bell/approval-card'
import { NoticeRow } from '@/web/ui/bell/notice-row'
import { Button } from '@/web/ui/kit/button'
import { Popover } from '@/web/ui/kit/popover'

export const BELL_POPOVER_ID = 'bell'

// Shown above while they wait; the log keeps them, but "Hôm nay" would say them twice.
const WAITING_KINDS: ReadonlySet<string> = new Set([
  'approval_requested',
  'clarification_requested',
])

export function BellPopover({ anchor }: { readonly anchor: RefObject<HTMLElement> }) {
  return (
    <Popover id={BELL_POPOVER_ID} anchor={anchor} label={tr('ui.office.bell.title')}>
      <BellHead />
      <div class="popover-scroll">
        <WaitingSection />
        <TodaySection />
      </div>
      <div class="popover-foot">
        <Button kind="tertiary" size="small" onClick={openActivityDialog}>
          {tr('ui.office.bell.all')}
        </Button>
      </div>
    </Popover>
  )
}

function BellHead() {
  const failure = useSignal<string | undefined>(undefined)

  function markAll(): void {
    markRead().then(
      () => {
        failure.value = undefined
      },
      (error: unknown) => {
        failure.value = error instanceof ApiFailure ? toFailureText(error) : undefined
      }
    )
  }

  return (
    <div class="popover-head bell-head">
      <h2>{tr('ui.office.bell.title')}</h2>
      {(unread.value ?? 0) > 0 && (
        <Button kind="tertiary" size="small" onClick={markAll}>
          {tr('ui.office.bell.markRead')}
        </Button>
      )}
      {failure.value !== undefined && (
        <p class="failure-line bell-head-failure" role="alert">
          {failure.value}
        </p>
      )}
    </div>
  )
}

function WaitingSection() {
  const entries = pending.value
  const count = entries.length

  if (count === 0) {
    return null
  }

  return (
    <>
      <h3 class="popover-section">
        {tr(pluralKey(count, 'ui.office.bell.waitingOne', 'ui.office.bell.waiting'), { count })}
      </h3>
      <div class="pending-list">
        {entries.map((entry) => (
          <PendingCard key={pendingRequestId(entry)} entry={entry} />
        ))}
      </div>
      {entries.some((entry) => entry.kind === 'approval') && (
        <p class="meta pending-timeout">{tr('ui.office.bell.timeout')}</p>
      )}
    </>
  )
}

function TodaySection() {
  const today = listToday()
  const failure = noticesFailure.value

  return (
    <>
      <h3 class="popover-section">{tr('ui.office.common.today')}</h3>
      {failure !== undefined && today.length === 0 && (
        <p class="failure-line">{toFailureText(failure)}</p>
      )}
      {failure === undefined && today.length === 0 && (
        <p class="meta">{tr('ui.office.bell.empty')}</p>
      )}
      {today.map((notice) => (
        <NoticeRow key={notice.id} notice={notice} />
      ))}
    </>
  )
}

// Today's notices in the daemon's own day, unread first, each group newest first.
function listToday(): readonly NoticeWire[] {
  const timeZone = state.value?.timeZone

  if (timeZone === undefined) {
    return []
  }

  const today = buildDayKey(Date.now(), timeZone)
  const shown = notices.value.filter(
    (notice) =>
      !WAITING_KINDS.has(notice.event.kind) && buildDayKey(notice.createdAt, timeZone) === today
  )

  return [
    ...shown.filter((notice) => notice.readAt === undefined),
    ...shown.filter((notice) => notice.readAt !== undefined),
  ]
}
