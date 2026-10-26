import type { RefObject } from 'preact'
import { useSignal } from '@preact/signals'
import { useLayoutEffect } from 'preact/hooks'

import type { NoticeWire } from '@/app/server/wire/notices'
import { pluralKey } from '@/i18n'
import { ApiFailure } from '@/web/api/client'
import { APPROVAL_KIND, pending, pendingRequestId } from '@/web/state/live'
import { isWaitingNotice, markRead, notices, noticesFailure, unread } from '@/web/state/notices'
import { state } from '@/web/state/session'
import { buildDayKey } from '@/web/text/time'
import { toFailureText, tr } from '@/web/text/tr'
import { openActivityDialog } from '@/web/ui/activity/activity-dialog'
import { PendingCard } from '@/web/ui/bell/approval-card'
import { clearChosenRequest } from '@/web/ui/bell/bell-keys'
import { NoticeRow } from '@/web/ui/bell/notice-row'
import { Button } from '@/web/ui/kit/button'
import { BELL_POPOVER_ID, Popover } from '@/web/ui/kit/popover'

export function BellPopover({ anchor }: { readonly anchor: RefObject<HTMLElement | null> }) {
  return (
    <Popover id={BELL_POPOVER_ID} anchor={anchor} label={tr('ui.office.bell.title')} takesFocus>
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

  useLayoutEffect(() => clearChosenRequest, [])

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
          <PendingCard key={pendingRequestId(entry)} entry={entry} isKeyed />
        ))}
      </div>
      {entries.some((entry) => entry.kind === APPROVAL_KIND) && (
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
  // A request still waiting shows above; once answered it is an ordinary row here.
  const shown = notices.value.filter(
    (notice) => !isWaitingNotice(notice) && buildDayKey(notice.createdAt, timeZone) === today
  )

  return [
    ...shown.filter((notice) => notice.readAt === undefined),
    ...shown.filter((notice) => notice.readAt !== undefined),
  ]
}
