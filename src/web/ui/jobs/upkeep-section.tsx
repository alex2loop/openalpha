import { useSignal } from '@preact/signals'

import type { TaskStatusWire, TasksResponse } from '@/app/server/wire/tasks'
import type { LoadState } from '@/web/ui/kit/use-load'
import { pluralKey } from '@/i18n'
import { state } from '@/web/state/session'
import { joinInline } from '@/web/text/glyphs'
import { formatClock, formatDuration } from '@/web/text/time'
import { toFailureText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { openSettings } from '@/web/ui/settings/settings'

/** One line for the daemon's own tasks; a failing one shows on its own with its sentence, and the
 *  toggle lists them all with cadence and last pass. */
export function UpkeepSection({ tasks }: { readonly tasks: LoadState<TasksResponse> }) {
  const isExpanded = useSignal(false)

  if (tasks.status === 'loading') {
    return <h3 class="sub-head">{tr('ui.office.jobs.maintenance')}</h3>
  }

  if (tasks.status === 'failed') {
    return (
      <>
        <h3 class="sub-head">{tr('ui.office.jobs.maintenance')}</h3>
        <p class="failure-line">{toFailureText(tasks.failure)}</p>
      </>
    )
  }

  const all = tasks.value.tasks
  const failing = all.filter((task) => task.lastError !== undefined)
  const shown = isExpanded.value ? all : failing

  return (
    <>
      <h3 class="sub-head">{tr('ui.office.jobs.maintenance')}</h3>
      <button
        type="button"
        class="upkeep-toggle"
        aria-expanded={isExpanded.value}
        onClick={() => {
          isExpanded.value = !isExpanded.value
        }}
      >
        <UpkeepSummary total={all.length} failing={failing.length} />
        <span class="meta">
          {isExpanded.value
            ? tr('ui.office.jobs.collapse')
            : tr(pluralKey(all.length, 'ui.office.jobs.seeAllOne', 'ui.office.jobs.seeAll'), {
                count: all.length,
              })}
        </span>
      </button>
      {shown.map((task) => (
        <UpkeepRow key={task.name} task={task} />
      ))}
    </>
  )
}

function UpkeepSummary({ total, failing }: { readonly total: number; readonly failing: number }) {
  return (
    <>
      <span>
        {tr(pluralKey(total, 'ui.office.jobs.autoOne', 'ui.office.jobs.auto'), { count: total })}
      </span>
      {failing > 0 ? (
        <span class="upkeep-status is-failing">
          {tr(pluralKey(failing, 'ui.office.jobs.failingOne', 'ui.office.jobs.failing'), {
            count: failing,
          })}
        </span>
      ) : (
        <span class="upkeep-status">{tr('ui.office.common.ok')}</span>
      )}
    </>
  )
}

function UpkeepRow({ task }: { readonly task: TaskStatusWire }) {
  const timeZone = state.value?.timeZone
  const facts = [
    ...(task.lastError === undefined ? [] : [task.lastError]),
    ...(task.everyMs === undefined
      ? []
      : [tr('ui.office.jobs.every', { time: formatDuration(task.everyMs) })]),
    ...(task.lastRunAt === undefined || timeZone === undefined
      ? []
      : [tr('ui.office.jobs.lastRun', { time: formatClock(task.lastRunAt, timeZone) })]),
  ]

  return (
    <div class={task.lastError === undefined ? 'job-row' : 'job-row is-failing'}>
      <div class="job-main">
        <b>{task.label}</b>
        {facts.length > 0 && <p class="meta">{joinInline(facts)}</p>}
      </div>
      {task.lastError !== undefined && (
        <Button size="small" onClick={() => openSettings('data')}>
          {tr('ui.office.common.fix')}
        </Button>
      )}
    </div>
  )
}
