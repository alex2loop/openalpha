import type { RefObject } from 'preact'

import type { TasksResponse } from '@/app/server/wire/tasks'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { type Run, runs } from '@/web/state/live'
import { loadSession, state } from '@/web/state/session'
import { tr } from '@/web/text/tr'
import { JobRow } from '@/web/ui/jobs/job-row'
import { UpcomingSection, WaitingSection } from '@/web/ui/jobs/schedule-sections'
import { UpkeepSection } from '@/web/ui/jobs/upkeep-section'
import { JOBS_POPOVER_ID, Popover } from '@/web/ui/kit/popover'
import { useLoad } from '@/web/ui/kit/use-load'

import './jobs.css'

/** What runs now, what runs next, what waits on an event, and the daemon's own upkeep. Opened by
 *  a click or the J key. The schedules are read again on open. */
export function JobsPopover({ anchor }: { readonly anchor: RefObject<HTMLElement> }) {
  return (
    <Popover
      id={JOBS_POPOVER_ID}
      anchor={anchor}
      label={tr('ui.office.header.runningTip')}
      class="jobs-popover"
    >
      <JobsBody />
    </Popover>
  )
}

function JobsBody() {
  const tasks = useLoad(loadTasks).value
  const schedules = state.value?.schedules ?? []

  return (
    <div class="popover-scroll">
      <RunningSection />
      <UpcomingSection schedules={schedules} tasks={tasks} />
      <WaitingSection schedules={schedules} tasks={tasks} />
      <UpkeepSection tasks={tasks} />
    </div>
  )
}

// `loadSession` keeps its own failure and the last good schedules; only the tasks can fail here.
async function loadTasks(signal: AbortSignal): Promise<TasksResponse> {
  const [tasks] = await Promise.all([getJson(ROUTES.tasks, { signal }), loadSession(signal)])

  return tasks
}

function RunningSection() {
  const shown = runs.value.filter((run) => !run.hidden)
  const ids = new Set(shown.map((run) => run.runId))
  // A child whose parent the page does not hold stands on its own.
  const tops = shown.filter((run) => run.parentRunId === undefined || !ids.has(run.parentRunId))

  return (
    <>
      <h3 class="popover-section">{tr('ui.office.jobs.running')}</h3>
      {tops.length === 0 && <p class="meta">{tr('ui.office.jobs.none')}</p>}
      {tops.map((run) => (
        <JobRow key={run.runId} run={run} childRuns={childrenOf(shown, run)} />
      ))}
    </>
  )
}

function childrenOf(shown: readonly Run[], parent: Run): readonly Run[] {
  return shown.filter((run) => run.parentRunId === parent.runId)
}
