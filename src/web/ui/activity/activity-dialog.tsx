import type { ActivityResponse, ActivityRowWire } from '@/app/server/wire/activity'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { state } from '@/web/state/session'
import { formatChildrenLine } from '@/web/text/activity'
import { formatUsd } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { formatRunName } from '@/web/text/run-name'
import { sourceLabel } from '@/web/text/source'
import { formatClock } from '@/web/text/time'
import { toFailureText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { closeModal, openModal } from '@/web/ui/kit/modal'
import { useLoad } from '@/web/ui/kit/use-load'

import './activity.css'

/** Today's finished runs, newest first, each with what it cost; delegated children fold under
 *  their parent. */
export function openActivityDialog(): void {
  openModal({
    title: tr('ui.office.activity.title'),
    body: <ActivityList />,
    footer: <Button onClick={closeModal}>{tr('ui.office.common.close')}</Button>,
    wide: true,
  })
}

function ActivityList() {
  const activity = useLoad(loadActivity).value

  if (activity.status === 'loading') {
    return null
  }

  if (activity.status === 'failed') {
    return <p class="failure-line">{toFailureText(activity.failure)}</p>
  }

  if (activity.value.rows.length === 0) {
    return <p class="meta">{tr('ui.office.jobs.none')}</p>
  }

  return (
    <div class="activity-list">
      {activity.value.rows.map((row) => (
        <ActivityItem key={row.runId} row={row} />
      ))}
    </div>
  )
}

function loadActivity(signal: AbortSignal): Promise<ActivityResponse> {
  return getJson(ROUTES.activity, { signal })
}

function ActivityItem({ row }: { readonly row: ActivityRowWire }) {
  const children = row.children ?? []

  if (children.length === 0) {
    return <ActivityLine row={row} />
  }

  return (
    <details class="activity-item">
      <summary>
        <ActivityLine row={row} />
        <span class="meta activity-children">{formatChildrenLine(children)}</span>
      </summary>
      <div class="activity-nested">
        {children.map((child) => (
          <ActivityLine key={child.runId} row={child} />
        ))}
      </div>
    </details>
  )
}

export function ActivityLine({ row }: { readonly row: ActivityRowWire }) {
  const timeZone = state.value?.timeZone
  const facts = [
    ...(timeZone === undefined ? [] : [formatClock(row.endedAt, timeZone)]),
    ...(row.agentId === undefined ? [] : [row.agentId]),
    sourceLabel(row.channelId),
  ]

  return (
    <div class="activity-line">
      <div class="activity-main">
        <b>{formatRunName(row)}</b>
        <p class="meta">{joinInline(facts)}</p>
        {row.summary !== undefined && <p class="activity-summary">{row.summary}</p>}
      </div>
      <span class="activity-cost">{formatUsd(row.costUsd)}</span>
    </div>
  )
}
