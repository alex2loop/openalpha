import type { ScheduleRow } from '@/app/server/wire/system'
import type { TasksResponse } from '@/app/server/wire/tasks'
import type { LoadState } from '@/web/ui/kit/use-load'
import { formatDay } from '@/i18n'
import { locale, state } from '@/web/state/session'
import { ABSENT_CELL } from '@/web/text/glyphs'
import { buildDayKey, formatClock } from '@/web/text/time'
import { tr } from '@/web/text/tr'

const MAX_UPCOMING = 8
// The task whose pass checks every alert, and so every event job's trigger.
const ALERTS_TASK_NAME = 'trading.alerts'
const MS_PER_SECOND = 1_000

interface SectionProps {
  readonly schedules: readonly ScheduleRow[]
  readonly tasks: LoadState<TasksResponse>
}

interface UpcomingItem {
  readonly key: string
  readonly at: number
  readonly title: string
  readonly detail?: string
}

/** Timed jobs, the brief and the intraday report, soonest first. */
export function UpcomingSection({ schedules, tasks }: SectionProps) {
  const items = buildUpcoming(schedules, tasks.status === 'ready' ? tasks.value : undefined)
  const timeZone = state.value?.timeZone

  return (
    <>
      <h3 class="popover-section">{tr('ui.office.jobs.upcoming')}</h3>
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
        </div>
      ))}
    </>
  )
}

/** Jobs that run when an alert fires: checked on the alert pass, so they cost no AI until then. */
export function WaitingSection({ schedules, tasks }: SectionProps) {
  const rows = schedules.filter((row) => row.event !== undefined && row.enabled !== false)
  const everyMs =
    tasks.status === 'ready'
      ? tasks.value.tasks.find((task) => task.name === ALERTS_TASK_NAME)?.everyMs
      : undefined
  const seconds = everyMs === undefined ? ABSENT_CELL : Math.round(everyMs / MS_PER_SECOND)

  return (
    <>
      <h3 class="popover-section">{tr('ui.office.jobs.waiting')}</h3>
      {rows.length === 0 && <p class="meta">{tr('ui.office.jobs.noWaiting')}</p>}
      {rows.map((row) => (
        <p key={String(row.id)} class="job-row meta">
          {tr('ui.office.jobs.waitingLine', {
            agent: readText(row.agentId) ?? String(row.id),
            when: describeEvent(row),
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

  return [
    {
      key: String(row.id),
      at: row.nextRunAt,
      title: readText(row.prompt) ?? String(row.id),
      ...(agentId === undefined ? {} : { detail: agentId }),
    },
  ]
}

function describeEvent(row: ScheduleRow): string {
  const trigger = row.event

  if (trigger === undefined) {
    return ''
  }

  const subject = trigger.ticker ?? tr('scheduler.event.anyName')

  return `${subject} ${tr(`scheduler.event.${trigger.event}`)}`
}

// Today reads as a clock; another day leads with its date.
function formatWhen(atMs: number, timeZone: string): string {
  const day = buildDayKey(atMs, timeZone)
  const clock = formatClock(atMs, timeZone)

  return day === buildDayKey(Date.now(), timeZone)
    ? clock
    : `${formatDay(locale.value, day)} ${clock}`
}

// Schedule rows are open: a field is read only when it holds text.
function readText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}
