import type { TaskStatusWire } from '@/app/server/wire/tasks'
import { ELAPSED_TICK_MS, useLiveNow } from '@/web/state/clock'
import { focusRun } from '@/web/state/focus'
import { hasStartedChild, type Run } from '@/web/state/live'
import { joinInline } from '@/web/text/glyphs'
import { commandOf, formatRunName } from '@/web/text/run-name'
import { sourceLabel } from '@/web/text/source'
import { formatElapsed } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { askStop } from '@/web/ui/kit/ask-stop'
import { Button } from '@/web/ui/kit/button'
import { StopButton } from '@/web/ui/kit/stop-button'
import { RunCalls } from '@/web/ui/run/calls/run-calls'
import { RunTimeline } from '@/web/ui/run/timeline/run-timeline'

interface JobRowProps {
  readonly run: Run
  readonly childRuns: readonly Run[]
}

/** A running run: what, who, its step, how long, where from, and "Dừng", which asks first. A
 *  parent lists its children under it. */
export function JobRow({ run, childRuns }: JobRowProps) {
  const now = useLiveNow(ELAPSED_TICK_MS).value

  return (
    <div class="job-row">
      <span class="spin" aria-hidden="true" />
      <div class="job-main">
        <b>
          {joinInline([formatRunName(run), ...(run.agentId === undefined ? [] : [run.agentId])])}
        </b>
        <p class="meta">
          {joinInline([
            ...(run.progress === undefined ? [] : [run.progress.text]),
            formatElapsed(now - run.startedAt),
            sourceLabel(run.channelId),
          ])}
        </p>
        {hasStartedChild(run.runId) && <RunTimeline key={run.runId} runId={run.runId} root={run} />}
        <RunCalls key={run.runId} runId={run.runId} isRunning command={commandOf(run)} />
      </div>
      <Button kind="tertiary" size="small" onClick={() => focusRun(run.runId)}>
        {tr('ui.office.common.view')}
      </Button>
      <StopButton onClick={() => askStop(run, childRuns.length > 0)} />
    </div>
  )
}

/** A background task of the daemon's own in a pass: it cannot be stopped or opened, only seen. */
export function TaskRow({ task }: { readonly task: TaskStatusWire }) {
  return (
    <div class="job-row">
      <span class="spin" aria-hidden="true" />
      <div class="job-main">
        <b>{task.label}</b>
        <p class="meta">{tr('ui.office.jobs.onItsOwn')}</p>
      </div>
    </div>
  )
}
