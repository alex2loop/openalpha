import { useSignal } from '@preact/signals'

import type { ScheduleRow } from '@/app/server/wire/system'
import type { TasksResponse } from '@/app/server/wire/tasks'
import { getJson, sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { agents } from '@/web/state/agents'
import { loadSession, state } from '@/web/state/session'
import { readText } from '@/web/text/fields'
import { ABSENT_CELL, joinInline } from '@/web/text/glyphs'
import { formatDuration, formatWhen } from '@/web/text/time'
import { toErrorText, toFailureText, tr } from '@/web/text/tr'
import { describeEvent } from '@/web/ui/jobs/schedule-sections'
import { useLoad } from '@/web/ui/kit/use-load'

/** Việc theo lịch: the daemon's own upkeep, and the schedules of the operator's agents, each with
 *  an on and off. A paused agent's schedules stay locked until it is resumed. */
export function SchedulesList() {
  const tasks = useLoad(loadTasks).value
  const schedules = state.value?.schedules ?? []

  return (
    <section class="setting-row">
      <h3 class="setting-title">{tr('ui.office.settings.jobs')}</h3>
      {tasks.status === 'failed' && <p class="failure-line">{toFailureText(tasks.failure)}</p>}
      {tasks.status === 'ready' && (
        <>
          <p>
            {tr('ui.office.settings.jobsCount', {
              system: tasks.value.tasks.length,
              agent: schedules.length,
            })}
          </p>
          <h4 class="sub-head">{tr('ui.office.settings.jobsSystem')}</h4>
          <SystemJobs tasks={tasks.value} />
        </>
      )}
      <div class="row-list">
        {schedules.map((row) => (
          <JobSwitch key={String(row.id)} row={row} />
        ))}
      </div>
    </section>
  )
}

function SystemJobs({ tasks }: { readonly tasks: TasksResponse }) {
  return (
    <div class="row-list">
      {tasks.tasks.map((task) => (
        <p key={task.name} class="meta">
          {joinInline([
            task.label,
            ...(task.everyMs === undefined
              ? []
              : [tr('ui.office.jobs.every', { time: formatDuration(task.everyMs) })]),
          ])}
        </p>
      ))}
    </div>
  )
}

function JobSwitch({ row }: { readonly row: ScheduleRow }) {
  const failure = useSignal<string | undefined>(undefined)
  const isBusy = useSignal(false)
  const agentId = readText(row.agentId)
  const isLocked = agents.value.some((agent) => agent.id === agentId && agent.paused)

  return (
    <div class="setting-job">
      <label class="form-check">
        <input
          type="checkbox"
          checked={row.enabled !== false}
          disabled={isLocked || isBusy.value}
          onChange={(event) => {
            toggle(row, event.currentTarget.checked, { failure, isBusy })
          }}
        />
        <span>{readText(row.prompt) ?? String(row.id)}</span>
      </label>
      <p class="meta">
        {joinInline([
          ...(agentId === undefined ? [] : [agentId]),
          describeWhen(row),
          ...(isLocked ? [tr('ui.office.settings.jobsLocked')] : []),
        ])}
      </p>
      {failure.value !== undefined && <p class="failure-line">{failure.value}</p>}
    </div>
  )
}

interface ToggleState {
  readonly failure: { value: string | undefined }
  readonly isBusy: { value: boolean }
}

function toggle(row: ScheduleRow, isOn: boolean, { failure, isBusy }: ToggleState): void {
  isBusy.value = true
  failure.value = undefined
  sendJson('POST', ROUTES.jobAction(String(row.id), isOn ? 'resume' : 'pause'))
    .then(() => loadSession(new AbortController().signal))
    .catch((error: unknown) => {
      failure.value = toErrorText(error)
    })
    .finally(() => {
      isBusy.value = false
    })
}

// An event job has no time of its own; a paused one has no next run.
function describeWhen(row: ScheduleRow): string {
  const timeZone = state.value?.timeZone

  if (row.event !== undefined) {
    return describeEvent(row.event)
  }

  return typeof row.nextRunAt === 'number' && timeZone !== undefined
    ? formatWhen(row.nextRunAt, timeZone)
    : ABSENT_CELL
}

function loadTasks(signal: AbortSignal): Promise<TasksResponse> {
  return getJson(ROUTES.tasks, { signal })
}
