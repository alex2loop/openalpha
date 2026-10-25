import { useSignal } from '@preact/signals'

import type { ResearchReportWire } from '@/app/server/wire/activity'
import { pluralKey } from '@/i18n'
import { type Run, runs } from '@/web/state/live'
import { state } from '@/web/state/session'
import { joinInline } from '@/web/text/glyphs'
import { formatRunName } from '@/web/text/run-name'
import { sourceLabel } from '@/web/text/source'
import { formatWhen } from '@/web/text/time'
import { toFailureText, tr } from '@/web/text/tr'
import { useResearch } from '@/web/ui/ideas/use-research'
import { Button } from '@/web/ui/kit/button'
import { Pager } from '@/web/ui/kit/pager'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { openReader } from '@/web/ui/reader/reader'

const RESEARCH_PAGE = 4
// The agent whose finished runs `/v1/research` lists.
const RESEARCH_AGENT = 'deep-researcher'

/** Kết quả nghiên cứu: the reports the daemon finished, four to a page, and any run still going. */
export function ResearchList() {
  const research = useResearch()
  const page = useSignal(0)
  const running = runs.value.filter(isResearchRun)
  const shown = research.rows.value.slice(
    page.value * RESEARCH_PAGE,
    (page.value + 1) * RESEARCH_PAGE
  )

  return (
    <section class="block">
      <h2 class="block-head">{tr('ui.office.ideas.research')}</h2>
      {research.failure.value !== undefined && (
        <div class="strip is-problem" role="alert">
          <span>{toFailureText(research.failure.value)}</span>
          <Button size="small" onClick={research.loadMore}>
            {tr('ui.office.common.retry')}
          </Button>
        </div>
      )}
      {page.value === 0 && running.map((run) => <RunningRow key={run.runId} run={run} />)}
      {shown.map((report) => (
        <ReportRow key={report.runId} report={report} />
      ))}
      {research.isLoading.value && shown.length === 0 && <Skeleton lines={2} />}
      {!research.isLoading.value &&
        research.failure.value === undefined &&
        shown.length === 0 &&
        running.length === 0 && <p class="meta">{tr('ui.office.today.empty')}</p>}
      <Pager
        page={page}
        size={RESEARCH_PAGE}
        total={research.rows.value.length}
        hasMore={research.hasMore.value}
        isLoading={research.isLoading.value}
        onLoadMore={research.loadMore}
      />
    </section>
  )
}

// Only the agent's own top-level runs: a child it spawned is part of the same research.
function isResearchRun(run: Run): boolean {
  return run.kind === 'agent' && run.name === RESEARCH_AGENT && run.parentRunId === undefined
}

function RunningRow({ run }: { readonly run: Run }) {
  return (
    <div class="research-row">
      <b>{formatRunName(run)}</b>
      <span class="meta">{tr('ui.office.ideas.running')}</span>
    </div>
  )
}

function ReportRow({ report }: { readonly report: ResearchReportWire }) {
  const timeZone = state.value?.timeZone
  const when = timeZone === undefined ? undefined : formatWhen(report.endedAt, timeZone)
  const count = report.sources

  return (
    <button
      type="button"
      class="research-row"
      onClick={() => openReader({ kind: 'research', sessionId: report.sessionId })}
    >
      <b>{report.title ?? when ?? sourceLabel(report.channelId)}</b>
      <span class="meta">{report.title === undefined ? undefined : when}</span>
      <span class="meta">
        {joinInline([
          ...(count === undefined
            ? []
            : [
                tr(pluralKey(count, 'ui.office.common.sourcesOne', 'ui.office.common.sources'), {
                  count,
                }),
              ]),
          sourceLabel(report.channelId),
        ])}
      </span>
    </button>
  )
}
