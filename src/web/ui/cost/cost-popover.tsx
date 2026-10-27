import type { RefObject } from 'preact'

import type { ActivityResponse, ActivityRowWire } from '@/app/server/wire/activity'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { cost, costFailure } from '@/web/state/cost'
import { state } from '@/web/state/session'
import { formatChildrenLine } from '@/web/text/activity'
import { formatUsd } from '@/web/text/figures'
import { formatRunName } from '@/web/text/run-name'
import { formatClock } from '@/web/text/time'
import { toFailureText, tr } from '@/web/text/tr'
import { openCostDialog } from '@/web/ui/cost/cost-dialog'
import { formatSpent } from '@/web/ui/cost/spent'
import { Button } from '@/web/ui/kit/button'
import { Popover } from '@/web/ui/kit/popover'
import { type LoadState, useLoad } from '@/web/ui/kit/use-load'
import { openSettings } from '@/web/ui/settings/settings'

import './cost.css'

export const COST_POPOVER_ID = 'cost'

const PERCENT = 100

/** Today and the month against their caps, today's spend by job, when the daemon warns, and the way
 *  to the full report. */
export function CostPopover({ anchor }: { readonly anchor: RefObject<HTMLElement | null> }) {
  return (
    <Popover
      id={COST_POPOVER_ID}
      anchor={anchor}
      label={tr('ui.office.cost.title')}
      class="cost-popover"
    >
      <CostBody />
      <div class="popover-foot">
        <Button kind="tertiary" size="small" onClick={openCostDialog}>
          {tr('ui.office.cost.full')}
        </Button>
      </div>
    </Popover>
  )
}

function CostBody() {
  const view = cost.value
  const timeZone = state.value?.timeZone
  const failure = costFailure.value

  return (
    <>
      <div class="popover-head">
        <h2>{tr('ui.office.cost.title')}</h2>
        {view !== undefined && timeZone !== undefined && (
          <span class="meta">
            {tr('ui.office.cost.until', { time: formatClock(view.readAt, timeZone) })}
          </span>
        )}
      </div>
      <div class="popover-scroll">
        {view === undefined && failure !== undefined && (
          <p class="failure-line">{toFailureText(failure)}</p>
        )}
        <CapLine
          label={tr('ui.office.common.today')}
          spentUsd={view?.todayUsd}
          capUsd={view?.caps.dailyUsd}
        />
        <CapLine
          label={tr('ui.office.cost.month')}
          spentUsd={view?.monthUsd}
          capUsd={view?.caps.monthlyUsd}
        />
        <ByJob />
        {view !== undefined && (view.caps.dailyUsd > 0 || view.caps.monthlyUsd > 0) && (
          <p class="meta cost-note">
            {tr('ui.office.cost.note', { percent: Math.round(view.caps.warnRatio * PERCENT) })}
          </p>
        )}
        <Button size="small" onClick={() => openSettings('agents')}>
          {tr('ui.office.cost.change')}
        </Button>
      </div>
    </>
  )
}

interface CapLineProps {
  readonly label: string
  readonly spentUsd: number | undefined
  readonly capUsd: number | undefined
}

// A cap of 0 is no cap: the line says so and draws no meter.
function CapLine({ label, spentUsd, capUsd }: CapLineProps) {
  const hasCap = capUsd !== undefined && capUsd > 0

  return (
    <>
      <h3 class="sub-head">{label}</h3>
      <p class="cost-figure">{formatSpent(spentUsd, capUsd)}</p>
      {hasCap && spentUsd !== undefined && (
        <div class="cost-meter" aria-hidden="true">
          <i style={{ width: `${Math.min(PERCENT, (spentUsd / capUsd) * PERCENT)}%` }} />
        </div>
      )}
      {capUsd === 0 && <p class="meta">{tr('ui.office.cost.uncapped')}</p>}
    </>
  )
}

function ByJob() {
  const activity = useLoad(loadActivity).value

  return (
    <>
      <h3 class="sub-head">{tr('ui.office.cost.byJob')}</h3>
      <ByJobRows activity={activity} />
    </>
  )
}

function loadActivity(signal: AbortSignal): Promise<ActivityResponse> {
  return getJson(ROUTES.activity, { signal })
}

function ByJobRows({ activity }: { readonly activity: LoadState<ActivityResponse> }) {
  if (activity.status === 'loading') {
    return null
  }

  if (activity.status === 'failed') {
    return <p class="failure-line">{toFailureText(activity.failure)}</p>
  }

  const rows = activity.value.rows.filter((row) => row.costUsd > 0)

  if (rows.length === 0) {
    return <p class="meta">{tr('ui.office.jobs.none')}</p>
  }

  return (
    <>
      {rows.map((row) => (
        <CostRow key={row.runId} row={row} />
      ))}
    </>
  )
}

// `costUsd` is the run and everything beneath it; the children line says how much was theirs.
function CostRow({ row }: { readonly row: ActivityRowWire }) {
  const children = row.children ?? []

  return (
    <div class="cost-row">
      <div class="cost-row-main">
        <b>{formatRunName(row)}</b>
        {row.agentId !== undefined && <p class="meta">{row.agentId}</p>}
        {children.length > 0 && <p class="meta">{formatChildrenLine(children)}</p>}
      </div>
      <span class="cost-row-figure">{formatUsd(row.costUsd)}</span>
    </div>
  )
}
