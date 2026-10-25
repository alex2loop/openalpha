import { type Signal, useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import type { SourcesResponse } from '@/app/server/wire/market'
import type { DoctorReport } from '@/app/server/wire/system'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { state } from '@/web/state/session'
import { ABSENT_CELL, joinInline } from '@/web/text/glyphs'
import { formatClock, formatWhen } from '@/web/text/time'
import { toErrorText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { Skeleton } from '@/web/ui/kit/skeleton'

type Source = SourcesResponse['sources'][number]
type Level = 'ok' | 'warn' | 'bad'

interface Health {
  readonly report: DoctorReport | undefined
  readonly sources: SourcesResponse | undefined
  readonly checkedAt: number | undefined
  readonly failure: string | undefined
  readonly isBusy: boolean
  /** Reads the checks and the sources again, and stamps the time. */
  recheck(): void
  /** Reads only the sources again. */
  refreshSources(): void
}

const LEVEL_LABELS = Object.freeze({
  ok: 'ui.office.common.ok',
  warn: 'ui.office.data.warn',
  bad: 'ui.office.data.bad',
} as const satisfies Record<Level, Parameters<typeof tr>[0]>)

/** Sức khỏe hệ thống and Nguồn dữ liệu: Ổn or Lỗi from the daemon's checks, Cần xem from a source
 *  that failed or that the daemon stopped calling. The daemon's `detail` is the hint on each row. */
export function DataHealth() {
  const health = useHealth()
  const { report, sources } = health

  return (
    <>
      <section class="setting-row">
        <h3 class="setting-title">{tr('ui.office.data.checks')}</h3>
        {health.failure !== undefined && <p class="failure-line">{health.failure}</p>}
        {report === undefined && health.failure === undefined && <Skeleton lines={3} />}
        {report !== undefined && <Checks report={report} sources={sources} />}
        <div class="setting-actions">
          <Button size="small" disabled={health.isBusy} onClick={health.recheck}>
            {health.isBusy ? tr('ui.office.data.rechecking') : tr('ui.office.common.recheck')}
          </Button>
          <CheckedLine health={health} />
        </div>
      </section>
      <SourcesList health={health} />
    </>
  )
}

function Checks({
  report,
  sources,
}: {
  readonly report: DoctorReport
  readonly sources: SourcesResponse | undefined
}) {
  return (
    <div class="row-list">
      {report.checks.map((check) => (
        <HealthRow
          key={check.name}
          level={check.ok ? 'ok' : 'bad'}
          title={check.name}
          hint={check.detail}
        />
      ))}
      {(sources?.sources ?? []).filter(isTroubled).map((source) => (
        <HealthRow key={source.id} level="warn" title={source.id} hint={source.failure} />
      ))}
    </div>
  )
}

function HealthRow({
  level,
  title,
  hint,
}: {
  readonly level: Level
  readonly title: string
  readonly hint: string | undefined
}) {
  return (
    <div class="setting-job">
      <div class="setting-actions">
        <b>{title}</b>
        <span class={level === 'ok' ? 'pill is-up' : 'pill is-down'}>
          {tr(LEVEL_LABELS[level])}
        </span>
      </div>
      {hint !== undefined && <p class="meta">{hint}</p>}
    </div>
  )
}

function CheckedLine({ health }: { readonly health: Health }) {
  const { report, sources, checkedAt } = health
  const timeZone = state.value?.timeZone

  if (report === undefined || checkedAt === undefined || timeZone === undefined) {
    return null
  }

  const ok = report.checks.filter((check) => check.ok).length

  return (
    <span class="meta">
      {tr('ui.office.data.checkedAt', {
        time: formatClock(checkedAt, timeZone),
        ok,
        warn: (sources?.sources ?? []).filter(isTroubled).length,
        bad: report.checks.length - ok,
      })}
    </span>
  )
}

function SourcesList({ health }: { readonly health: Health }) {
  const timeZone = state.value?.timeZone

  return (
    <section class="setting-row">
      <h3 class="setting-title">{tr('ui.office.data.sources')}</h3>
      {health.sources === undefined && health.failure === undefined && <Skeleton lines={3} />}
      {health.sources?.sources.map((source) => (
        <div key={`${source.id}:${source.kind}`} class="setting-job">
          <div class="setting-actions">
            <b class="mono">{source.id}</b>
            <span class="meta">
              {joinInline([
                source.kind,
                source.lastSuccessAt === undefined || timeZone === undefined
                  ? ABSENT_CELL
                  : tr('ui.office.data.lastRead', {
                      time: formatWhen(source.lastSuccessAt, timeZone),
                    }),
              ])}
            </span>
          </div>
          {isTroubled(source) && source.failure !== undefined && (
            <p class="meta">{source.failure}</p>
          )}
        </div>
      ))}
      <div class="setting-actions">
        <Button size="small" disabled={health.isBusy} onClick={health.refreshSources}>
          {tr('ui.office.data.refresh')}
        </Button>
      </div>
    </section>
  )
}

function isTroubled(source: Source): boolean {
  return source.breaker === 'open' || source.failure !== undefined
}

// The first read when the section opens; leaving it, or a newer read, aborts the one in flight.
function useHealth(): Health {
  const report = useSignal<DoctorReport | undefined>(undefined)
  const sources = useSignal<SourcesResponse | undefined>(undefined)
  const checkedAt = useSignal<number | undefined>(undefined)
  const { failure, isBusy, run } = useLatestRead()

  const recheck = (): void =>
    run(async (signal) => {
      const [nextReport, nextSources] = await Promise.all([
        getJson(ROUTES.doctor, { signal }),
        getJson(ROUTES.sources, { signal }),
      ])

      report.value = nextReport
      sources.value = nextSources
      checkedAt.value = Date.now()
    })
  const refreshSources = (): void =>
    run(async (signal) => {
      sources.value = await getJson(ROUTES.sources, { signal })
    })

  useEffect(recheck, [])

  return {
    report: report.value,
    sources: sources.value,
    checkedAt: checkedAt.value,
    failure: failure.value,
    isBusy: isBusy.value,
    recheck,
    refreshSources,
  }
}

// One read at a time: a newer one aborts the one in flight, and so does leaving the section.
function useLatestRead(): {
  readonly failure: Signal<string | undefined>
  readonly isBusy: Signal<boolean>
  readonly run: (read: (signal: AbortSignal) => Promise<void>) => void
} {
  const failure = useSignal<string | undefined>(undefined)
  const isBusy = useSignal(false)
  const running = useRef<AbortController | undefined>(undefined)

  useEffect(() => () => running.current?.abort(), [])

  function run(read: (signal: AbortSignal) => Promise<void>): void {
    const controller = new AbortController()

    running.current?.abort()
    running.current = controller
    isBusy.value = true
    failure.value = undefined
    read(controller.signal)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          failure.value = toErrorText(error)
        }
      })
      .finally(() => {
        if (running.current === controller) {
          isBusy.value = false
        }
      })
  }

  return { failure, isBusy, run }
}
