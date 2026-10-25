import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import type { AgentView } from '@/web/ui/agent/agent-view'
import { reputationLine, setPaused } from '@/web/state/agents'
import { runs } from '@/web/state/live'
import { state } from '@/web/state/session'
import { joinInline } from '@/web/text/glyphs'
import { formatRunName } from '@/web/text/run-name'
import { formatClock } from '@/web/text/time'
import { toErrorText, tr } from '@/web/text/tr'
import { clearSavedNote, savedNote } from '@/web/ui/agent/form/agent-form'
import { askStop } from '@/web/ui/jobs/job-row'
import { describeEvent } from '@/web/ui/jobs/schedule-sections'
import { Button } from '@/web/ui/kit/button'

// The assistant's own desk: it wears the mascot, and says so.
const ASSISTANT_ID = 'assistant'

/** Name, what it does now (or did last), "Dừng" for a run under way, and pause or resume for an
 *  agent of the operator's own. */
export function AgentHead({ view }: { readonly view: AgentView }) {
  const failure = useSignal<string | undefined>(undefined)
  const { agent, run } = view
  const minSample = state.value?.trackRecordMinSample

  // The "saved" line belongs to the visit that followed the save.
  useEffect(() => () => clearSavedNote(view.agentId), [])

  return (
    <header class="agent-head">
      <h2 class="agent-name">
        {view.name}
        {view.agentId === ASSISTANT_ID && (
          <span class="agent-tag">{tr('ui.office.agent.assistantTag')}</span>
        )}
        {agent !== undefined && minSample !== undefined && (
          <span class="agent-tag">{reputationLine(agent, minSample)}</span>
        )}
      </h2>
      <p class="meta">{describeNow(view)}</p>
      {agent?.paused === true && <p class="agent-note">{tr('ui.office.agent.pausedNote')}</p>}
      {savedNote.value?.agentId === view.agentId && (
        <p class="agent-note">{tr('ui.office.form.saved', { name: savedNote.value.name })}</p>
      )}
      <div class="agent-actions">
        {run !== undefined && (
          <Button
            kind="destructive"
            size="small"
            onClick={() => askStop(run, hasChildren(run.runId))}
          >
            {tr('ui.office.common.stop')}
          </Button>
        )}
        {agent !== undefined && (
          <Button size="small" onClick={() => togglePause(agent.id, !agent.paused, failure)}>
            {tr(agent.paused ? 'ui.office.agent.resume' : 'ui.office.agent.pause')}
          </Button>
        )}
      </div>
      {failure.value !== undefined && <p class="failure-line">{failure.value}</p>}
    </header>
  )
}

// The run under way, else what it waits for, else its last run today, else free.
function describeNow(view: AgentView): string {
  const { run, rows, agent } = view
  const timeZone = state.value?.timeZone
  const schedules = (state.value?.schedules ?? []).filter((row) => row.agentId === view.agentId)
  const waiting = schedules.find((row) => row.event !== undefined && row.enabled !== false)?.event
  const last = rows[0]

  if (run !== undefined) {
    return joinInline([
      formatRunName(run),
      ...(run.progress === undefined ? [] : [run.progress.text]),
    ])
  }

  if (waiting !== undefined) {
    return tr('ui.office.agent.waiting', { what: describeEvent(waiting) })
  }

  if (last !== undefined && timeZone !== undefined) {
    return tr('ui.office.agent.lastRun', {
      what: formatRunName(last),
      time: formatClock(last.endedAt, timeZone),
    })
  }

  return agent !== undefined && schedules.length === 0
    ? joinInline([tr('ui.office.status.free'), tr('ui.office.agent.noPlan')])
    : tr('ui.office.status.free')
}

function hasChildren(runId: string): boolean {
  return runs.value.some((held) => held.parentRunId === runId)
}

function togglePause(
  agentId: string,
  paused: boolean,
  failure: { value: string | undefined }
): void {
  failure.value = undefined
  setPaused(agentId, paused).catch((error: unknown) => {
    failure.value = toErrorText(error)
  })
}
