import { type Signal, useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import type { CostReport } from '@/app/server/wire/system'
import type { MessageKey } from '@/i18n'
import { formatDay } from '@/i18n'
import { ApiFailure, getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { locale, state } from '@/web/state/session'
import { joinInline } from '@/web/text/glyphs'
import { buildDayKey } from '@/web/text/time'
import { buildMonthStart, shiftDay } from '@/web/text/time-units'
import { tr } from '@/web/text/tr'
import { CostBreakdown } from '@/web/ui/cost/cost-breakdown'
import { CostChart } from '@/web/ui/cost/cost-chart'
import { formatSpent } from '@/web/ui/cost/spent'
import { Button } from '@/web/ui/kit/button'
import { FailureStrip } from '@/web/ui/kit/failure-strip'
import { closeModal, openModal } from '@/web/ui/kit/modal'
import { Segmented } from '@/web/ui/kit/segmented'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { openSettings } from '@/web/ui/settings/settings'

import './cost.css'

const COST_PERIODS = ['today', 'week', 'days30', 'month'] as const

type CostPeriod = (typeof COST_PERIODS)[number]

const PERIOD_LABELS: Readonly<Record<CostPeriod, MessageKey>> = Object.freeze({
  today: 'ui.office.cost.period.today',
  week: 'ui.office.cost.period.week',
  days30: 'ui.office.cost.period.days30',
  month: 'ui.office.cost.month',
})
// How many days a rolling period spans, today included.
const WEEK_DAYS = 7
const DAYS_30 = 30

interface CostRead {
  readonly report: Signal<CostReport | undefined>
  readonly failure: Signal<ApiFailure | undefined>
  readonly retry: () => void
}

/** "Chi phí AI" in full: a period's total, its days as bars, and where it went by job, agent and
 *  model. */
export function openCostDialog(): void {
  openModal({
    title: tr('ui.office.cost.title'),
    body: <CostReportBody />,
    footer: (
      <>
        <Button onClick={() => openSettings('agents')}>{tr('ui.office.cost.change')}</Button>
        <Button onClick={closeModal}>{tr('ui.office.common.close')}</Button>
      </>
    ),
    wide: true,
  })
}

function CostReportBody() {
  const period = useSignal<CostPeriod>('today')
  const read = useCostRead(period.value)
  const report = read.report.value
  const failure = read.failure.value

  return (
    <div class="flow">
      <Segmented
        label={tr('ui.office.cost.title')}
        value={period.value}
        options={COST_PERIODS.map((value) => ({ value, label: tr(PERIOD_LABELS[value]) }))}
        onChange={(value) => {
          period.value = value
        }}
      />
      {failure !== undefined && <FailureStrip failure={failure} retry={read.retry} />}
      {report === undefined && failure === undefined && <Skeleton />}
      {report !== undefined && <ReportView report={report} period={period.value} />}
    </div>
  )
}

// One read per period choice or retry, the one before aborted; the last period's report never shows
// under the new one's label.
function useCostRead(period: CostPeriod): CostRead {
  const report = useSignal<CostReport | undefined>(undefined)
  const failure = useSignal<ApiFailure | undefined>(undefined)
  const tries = useSignal(0)
  const timeZone = state.value?.timeZone
  const triesValue = tries.value

  useEffect(() => {
    report.value = undefined
    failure.value = undefined

    if (timeZone === undefined) {
      return undefined
    }

    const controller = new AbortController()
    const today = buildDayKey(Date.now(), timeZone)

    getJson(ROUTES.cost, {
      query: { from: resolvePeriodStart(period, today), to: today },
      signal: controller.signal,
    }).then(
      (value) => {
        report.value = value
        failure.value = undefined
      },
      (error: unknown) => {
        // Anything but an `ApiFailure` is this read's own abort.
        if (error instanceof ApiFailure) {
          failure.value = error
        }
      }
    )

    return () => controller.abort()
  }, [period, timeZone, triesValue])

  return {
    report,
    failure,
    retry: () => {
      tries.value++
    },
  }
}

// Days are the daemon's, so every period ends on its today.
function resolvePeriodStart(period: CostPeriod, today: string): string {
  switch (period) {
    case 'today':
      return today
    case 'week':
      return shiftDay(today, 1 - WEEK_DAYS)
    case 'days30':
      return shiftDay(today, 1 - DAYS_30)
    case 'month':
      return buildMonthStart(today)
    default: {
      const unknown: never = period

      return unknown
    }
  }
}

function ReportView({
  report,
  period,
}: {
  readonly report: CostReport
  readonly period: CostPeriod
}) {
  if (report.totalUsd === 0) {
    return <p class="empty-note">{tr('ui.office.cost.empty')}</p>
  }

  return (
    <>
      <h3 class="sub-head">
        {joinInline([tr('ui.office.cost.total'), tr(PERIOD_LABELS[period])])}
      </h3>
      <div class="stack">
        <p class="big-figure cost-figure">{formatSpent(report.totalUsd, undefined)}</p>
        <HighestDay days={report.days} />
      </div>
      <CostChart days={report.days} />
      <CostBreakdown report={report} />
    </>
  )
}

function HighestDay({ days }: { readonly days: CostReport['days'] }) {
  const highest = days.reduce<CostReport['days'][number] | undefined>(
    (top, entry) => (top === undefined || entry.costUsd > top.costUsd ? entry : top),
    undefined
  )

  if (days.length < 2 || highest === undefined) {
    return null
  }

  return (
    <p class="meta">
      {tr('ui.office.cost.highest', {
        usd: formatSpent(highest.costUsd, undefined),
        day: formatDay(locale.value, highest.day),
      })}
    </p>
  )
}
