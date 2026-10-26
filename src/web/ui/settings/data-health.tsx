import { type Signal, useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import type { SourcesResponse } from '@/app/server/wire/market'
import type { DoctorCheck, DoctorReport } from '@/app/server/wire/system'
import type { SettingsSection } from '@/web/state/settings'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { state } from '@/web/state/session'
import { ABSENT_CELL, joinInline } from '@/web/text/glyphs'
import { formatWhen } from '@/web/text/time'
import { toErrorText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { DoctorRows } from '@/web/ui/settings/doctor-rows'

type Source = SourcesResponse['sources'][number]

const ONLINE_QUERY = Object.freeze({ online: 1 })

// What the checks and the sources answered last; a failed read keeps them.
interface Health {
  readonly report: DoctorReport | undefined
  readonly sources: SourcesResponse | undefined
  readonly failure: string | undefined
  readonly isBusy: boolean
  /** Reads the checks, with the network probes, and the sources again. */
  recheck(): void
  /** Reads only the sources again. */
  refreshSources(): void
}

/** Sức khỏe hệ thống and Nguồn dữ liệu: the daemon's `doctor` checks, then a source that failed or
 *  that the daemon stopped calling. `openSection` moves Cài đặt to where a check is fixed. */
export function DataHealth({
  openSection,
}: {
  readonly openSection: (section: SettingsSection) => void
}) {
  const health = useHealth()
  const { report, sources } = health

  return (
    <>
      <section class="setting-row">
        <h3 class="setting-title">{tr('ui.office.data.checks')}</h3>
        {health.failure !== undefined && <p class="failure-line">{health.failure}</p>}
        {report === undefined && health.failure === undefined && <Skeleton lines={3} />}
        {report !== undefined && (
          <DoctorRows
            report={report}
            troubled={(sources?.sources ?? []).filter(isTroubled)}
            openSection={openSection}
          />
        )}
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

// The time the daemon ran the checks, so a report kept through an outage shows its age.
function CheckedLine({ health }: { readonly health: Health }) {
  const { report, sources } = health
  const timeZone = state.value?.timeZone

  if (report === undefined || timeZone === undefined) {
    return null
  }

  const count = (status: DoctorCheck['status']): number =>
    report.checks.filter((check) => check.status === status).length

  return (
    <span class="meta">
      {tr('ui.office.data.checkedAt', {
        time: formatWhen(report.checkedAt, timeZone),
        ok: count('ok') + count('info'),
        warn: count('warn') + (sources?.sources ?? []).filter(isTroubled).length,
        bad: count('fail'),
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

// The first read when the section opens runs offline; leaving it, or a newer read, aborts the one
// in flight.
function useHealth(): Health {
  const report = useSignal<DoctorReport | undefined>(undefined)
  const sources = useSignal<SourcesResponse | undefined>(undefined)
  const { failure, isBusy, run } = useLatestRead()

  const read = (online: boolean): void =>
    run(async (signal) => {
      const [nextReport, nextSources] = await Promise.all([
        getJson(ROUTES.doctor, { signal, ...(online ? { query: ONLINE_QUERY } : {}) }),
        getJson(ROUTES.sources, { signal }),
      ])

      report.value = nextReport
      sources.value = nextSources
    })
  const refreshSources = (): void =>
    run(async (signal) => {
      sources.value = await getJson(ROUTES.sources, { signal })
    })

  useEffect(() => read(false), [])

  return {
    report: report.value,
    sources: sources.value,
    failure: failure.value,
    isBusy: isBusy.value,
    recheck: () => read(true),
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
