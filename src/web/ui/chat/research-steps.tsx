import { useEffect } from 'preact/hooks'

import type { Turn } from '@/web/state/chat'
import { ROUTES } from '@/web/api/routes'
import { useBlock } from '@/web/state/block'
import { onWireEvent } from '@/web/state/events'
import { findRun } from '@/web/state/live'
import { tr } from '@/web/text/tr'
import { StepList } from '@/web/ui/agent/steps'
import { commandWordOf } from '@/web/ui/chat/command-link'
import { Button } from '@/web/ui/kit/button'
import { openReader } from '@/web/ui/reader/reader'

export const RESEARCH_COMMAND = '/research'

/** How many of the newest reports a run is looked up among. */
export const RESEARCH_LOOKUP = 20

/** The line is a `/research` command, whose answer is a report with numbered sources. */
export function isResearchTurn(turn: Turn): boolean {
  return turn.kind === 'slash' && commandWordOf(turn.text) === RESEARCH_COMMAND
}

/** The steps a running research reported, and what stopping it costs; nothing once the run is gone. */
export function ResearchSteps({ runId }: { readonly runId: string }) {
  const run = findRun(runId)

  if (run === undefined) {
    return null
  }

  return (
    <>
      <StepList run={run} />
      <p class="meta">{tr('ui.office.research.stopNote')}</p>
    </>
  )
}

/** Opens the run's report in the reader once the daemon lists it; until then, nothing. */
export function ResearchReportLink({ runId }: { readonly runId: string }) {
  const reading = useBlock(ROUTES.research, { query: { limit: RESEARCH_LOOKUP } })
  const report = reading.data?.reports.find((held) => held.runId === runId)

  // The report is listed as the run ends, which can be after this answer is done.
  useEffect(
    () =>
      onWireEvent('run_finished', (event) => {
        if (event.runId === runId) {
          reading.retry()
        }
      }),
    [runId]
  )

  if (report === undefined) {
    return null
  }

  return (
    <Button
      kind="tertiary"
      size="small"
      onClick={() =>
        openReader({ kind: 'research', sessionId: report.sessionId, runId: report.runId })
      }
    >
      {tr('ui.office.research.openReader')}
    </Button>
  )
}
