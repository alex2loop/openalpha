import type { ComponentChildren } from 'preact'

import type { ActivityRowWire, ResearchReportWire } from '@/app/server/wire/activity'
import type { BoardEntryWire } from '@/app/server/wire/notices'
import type { AgentView } from '@/web/ui/agent/agent-view'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { useBlock, useBlockRead } from '@/web/state/block'
import { formatRunName } from '@/web/text/run-name'
import { toFailureText, tr } from '@/web/text/tr'
import { RESEARCH_LOOKUP } from '@/web/ui/chat/research-steps'
import { SuggestionCard } from '@/web/ui/ideas/suggestion-card'
import { Button } from '@/web/ui/kit/button'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { Markdown } from '@/web/ui/markdown/markdown'
import { openReader } from '@/web/ui/reader/reader'
import { RunCalls } from '@/web/ui/run/calls/run-calls'
import { TickerLink } from '@/web/ui/ticker/ticker-link'

interface Finished {
  readonly board: readonly BoardEntryWire[]
  readonly reports: readonly ResearchReportWire[]
}

/** "Kết quả": the agent's latest finished run where it is kept: a command's answer, a research
 *  report, or its latest stored call. */
export function AgentResult({ view }: { readonly view: AgentView }) {
  if (view.rows.length === 0) {
    return <StoredCall view={view} />
  }

  return <LatestRun view={view} />
}

function LatestRun({ view }: { readonly view: AgentView }) {
  const reading = useBlockRead(loadFinished)

  if (reading.data === undefined) {
    return reading.state === 'failed' ? <StoredCall view={view} /> : <Skeleton />
  }

  for (const row of view.rows) {
    const entry = reading.data.board.find((held) => held.runId === row.runId)
    const report = reading.data.reports.find((held) => held.runId === row.runId)

    if (entry !== undefined) {
      return (
        <WithCalls row={row}>
          <BoardResult entry={entry} />
        </WithCalls>
      )
    }

    if (report !== undefined) {
      return (
        <WithCalls row={row}>
          <ReportResult report={report} row={row} />
        </WithCalls>
      )
    }
  }

  return <StoredCall view={view} />
}

// The run's AI calls sit under whatever it answered.
function WithCalls({
  row,
  children,
}: {
  readonly row: ActivityRowWire
  readonly children: ComponentChildren
}) {
  return (
    <>
      {children}
      <RunCalls key={row.runId} runId={row.runId} isRunning={false} />
    </>
  )
}

function BoardResult({ entry }: { readonly entry: BoardEntryWire }) {
  return (
    <article class="agent-section">
      <h3 class="sub-head">{entry.title}</h3>
      {entry.tickers.length > 0 && <TickerLinks tickers={entry.tickers} />}
      <Markdown text={entry.text} />
    </article>
  )
}

function ReportResult({
  report,
  row,
}: {
  readonly report: ResearchReportWire
  readonly row: ActivityRowWire
}) {
  return (
    <Button
      kind="tertiary"
      onClick={() => openReader({ kind: 'research', sessionId: report.sessionId })}
    >
      {report.title ?? formatRunName(row)}
    </Button>
  )
}

// Only an agent with a record has stored a call under its focus.
function StoredCall({ view }: { readonly view: AgentView }) {
  const { agent } = view

  if (agent?.record === undefined) {
    return <p class="meta">{tr('ui.office.agent.noResult')}</p>
  }

  return <LatestCall focusKey={agent.focusKey} />
}

function LatestCall({ focusKey }: { readonly focusKey: string }) {
  const reading = useBlock(ROUTES.suggestions, {
    query: { status: 'all', focus: focusKey, limit: 1 },
  })
  const call = reading.data?.suggestions[0]

  if (reading.state === 'loading') {
    return <Skeleton />
  }

  if (call === undefined && reading.error !== undefined) {
    return <p class="failure-line">{toFailureText(reading.error)}</p>
  }

  return call === undefined ? (
    <p class="meta">{tr('ui.office.agent.noResult')}</p>
  ) : (
    <SuggestionCard call={call} isFresh={false} />
  )
}

/** The names a run reported on, each opening its card. */
export function TickerLinks({ tickers }: { readonly tickers: readonly string[] }) {
  return (
    <p class="agent-tickers">
      {tickers.map((ticker) => (
        <TickerLink key={ticker} ticker={ticker} />
      ))}
    </p>
  )
}

async function loadFinished(abort: AbortSignal): Promise<Finished> {
  const [board, research] = await Promise.all([
    getJson(ROUTES.board, { signal: abort }),
    getJson(ROUTES.research, { query: { limit: RESEARCH_LOOKUP }, signal: abort }),
  ])

  return { board: board.entries, reports: research.reports }
}
