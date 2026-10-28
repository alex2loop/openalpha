import type { ScheduleRow } from '@/app/server/wire/system'
import type { TasksResponse } from '@/app/server/wire/tasks'
import type { LoadState } from '@/web/ui/kit/use-load'
import { ALERTS_TASK_NAME } from '@/web/scene/data/agenda'
import { runCommand } from '@/web/state/command'
import { state } from '@/web/state/session'
import { readText } from '@/web/text/fields'
import { ABSENT_CELL } from '@/web/text/glyphs'
import { describeEvent } from '@/web/text/schedule-event'
import { formatWhen } from '@/web/text/time'
import { MS_PER_SECOND } from '@/web/text/time-units'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { closePopover } from '@/web/ui/kit/popover'

const MAX_UPCOMING = 8

interface SectionProps {
  readonly schedules: readonly ScheduleRow[]
  readonly tasks: LoadState<TasksResponse>
}

interface UpcomingItem {
  readonly key: string
  readonly at: number
  readonly title: string
  readonly detail?: string
  /** A schedule's own command, which "Chạy lại" puts in the box. */
  readonly rerun?: { readonly text: string; readonly agentId?: string }
}

/** Timed jobs, the brief and the intraday report, soonest first. */
export function UpcomingSection({ schedules, tasks }: SectionProps) {
  const items = buildUpcoming(schedules, tasks.status === 'ready' ? tasks.value : undefined)
  const timeZone = state.value?.timeZone

  return (
    <>
      <h3 class="sub-head">{tr('ui.office.jobs.upcoming')}</h3>
      {items.length === 0 && <p class="meta">{tr('ui.office.jobs.none')}</p>}
      {items.map((item) => (
        <div key={item.key} class="job-row">
          <span class="job-time">
            {timeZone === undefined ? ABSENT_CELL : formatWhen(item.at, timeZone)}
          </span>
          <div class="job-main">
            <b>{item.title}</b>
            {item.detail !== undefined && <p class="meta">{item.detail}</p>}
          </div>
          {item.rerun !== undefined && <RerunButton rerun={item.rerun} />}
        </div>
      ))}
    </>
  )
}

/** Jobs that run when an alert fires: checked on the alert pass, so they cost no AI until then. */
export function WaitingSection({ schedules, tasks }: SectionProps) {
  const rows = schedules.filter((row) => row.event !== undefined && row.enabled !== false)
  const seconds = formatAlertSeconds(tasks)

  return (
    <>
      <h3 class="sub-head">{tr('ui.office.jobs.waiting')}</h3>
      {rows.length === 0 && <p class="meta">{tr('ui.office.jobs.noWaiting')}</p>}
      {rows.map((row) => (
        <p key={String(row.id)} class="job-row meta">
          {tr('ui.office.jobs.waitingLine', {
            agent: readText(row.agentId) ?? String(row.id),
            when: row.event === undefined ? '' : describeEvent(row.event),
            seconds,
          })}
        </p>
      ))}
    </>
  )
}

function buildUpcoming(
  schedules: readonly ScheduleRow[],
  tasks: TasksResponse | undefined
): readonly UpcomingItem[] {
  const items = schedules.flatMap(toUpcoming)
  const brief = tasks?.brief
  const intraday = tasks?.intraday

  if (brief?.state === 'scheduled' && brief.nextDueAt !== undefined) {
    items.push({ key: 'brief', at: brief.nextDueAt, title: tr('ui.task.trading.briefs') })
  }

  if (intraday?.enabled === true && intraday.nextAt !== null) {
    items.push({ key: 'intraday', at: intraday.nextAt, title: tr('ui.task.trading.intraday') })
  }

  return items.sort((a, b) => a.at - b.at).slice(0, MAX_UPCOMING)
}

// An event job and a paused one have no time of their own.
function toUpcoming(row: ScheduleRow): UpcomingItem[] {
  if (row.event !== undefined || row.enabled === false || typeof row.nextRunAt !== 'number') {
    return []
  }

  const agentId = readText(row.agentId)
  const prompt = readText(row.prompt)

  return [
    {
      key: String(row.id),
      at: row.nextRunAt,
      title: prompt ?? String(row.id),
      ...(agentId === undefined ? {} : { detail: agentId }),
      ...(prompt === undefined
        ? {}
        : { rerun: { text: prompt, ...(agentId === undefined ? {} : { agentId }) } }),
    },
  ]
}

// Sends the job's prompt now, to the agent it names.
function RerunButton({ rerun }: { readonly rerun: NonNullable<UpcomingItem['rerun']> }) {
  return (
    <Button
      size="small"
      onClick={() => {
        closePopover()
        runCommand(rerun.text, rerun.agentId === undefined ? {} : { agentId: rerun.agentId })
      }}
    >
      {tr('ui.office.jobs.rerun')}
    </Button>
  )
}

/** How often the alert pass checks every event job's trigger, in whole seconds; absent until read. */
export function formatAlertSeconds(tasks: LoadState<TasksResponse>): string | number {
  const everyMs =
    tasks.status === 'ready'
      ? tasks.value.tasks.find((task) => task.name === ALERTS_TASK_NAME)?.everyMs
      : undefined

  return everyMs === undefined ? ABSENT_CELL : Math.round(everyMs / MS_PER_SECOND)
}
