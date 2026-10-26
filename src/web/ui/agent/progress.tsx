import { useSignal } from '@preact/signals'

import type { Run } from '@/web/state/live'
import { pluralKey } from '@/i18n'
import { tr } from '@/web/text/tr'
import { ChildNest } from '@/web/ui/agent/child-nest'
import { StepList } from '@/web/ui/agent/steps'
import { Pager } from '@/web/ui/kit/pager'
import { toSafeHref } from '@/web/ui/markdown/inline'

const SOURCES_PAGE = 5

interface ProgressProps {
  readonly run: Run | undefined
  /** How many children one `spawn` call may start; absent when the agent may start none. */
  readonly maxSpawn: number | undefined
}

/** "Tiến độ": the run's steps, the child agents it handed work to, and the pages it read. */
export function Progress({ run, maxSpawn }: ProgressProps) {
  if (run === undefined) {
    return <p class="meta">{tr('ui.office.status.free')}</p>
  }

  return (
    <>
      <StepList run={run} />
      <ChildNest key={run.runId} parent={run} maxSpawn={maxSpawn} />
      <SourcesRead key={run.runId} run={run} />
    </>
  )
}

function SourcesRead({ run }: { readonly run: Run }) {
  const page = useSignal(0)
  const sources = listSources(run)

  if (sources.length === 0) {
    return null
  }

  const shown = sources.slice(page.value * SOURCES_PAGE, (page.value + 1) * SOURCES_PAGE)

  return (
    <section class="agent-section">
      <h3 class="sub-head">
        {tr(
          pluralKey(
            sources.length,
            'ui.office.common.sourcesReadOne',
            'ui.office.common.sourcesRead'
          ),
          { count: sources.length }
        )}
      </h3>
      <ul class="agent-sources">
        {shown.map((url) => (
          <li key={url}>
            <a href={url} target="_blank" rel="noopener noreferrer">
              {url}
            </a>
          </li>
        ))}
      </ul>
      <Pager
        page={page}
        size={SOURCES_PAGE}
        total={sources.length}
        hasMore={false}
        isLoading={false}
        onLoadMore={() => undefined}
      />
    </section>
  )
}

// The addresses the run's own lines named, first seen first; a link is web only.
function listSources(run: Run): readonly string[] {
  const lines = run.progress === undefined ? run.persistent : [...run.persistent, run.progress]
  const urls = lines.flatMap((line) => {
    const url = line.params?.url

    return typeof url === 'string' && toSafeHref(url) !== undefined ? [url] : []
  })

  return [...new Set(urls)]
}
