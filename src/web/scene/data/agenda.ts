import { computed, type ReadonlySignal, signal } from '@preact/signals'

import type { MarketSessionWire, MarketWire } from '@/app/server/wire/market'
import type { ScheduleRow } from '@/app/server/wire/system'
import type { TaskStatusWire, TasksResponse } from '@/app/server/wire/tasks'
import { formatDay, type MessageKey } from '@/i18n'
import { getJson } from '@/web/api/client'
import { startPoll } from '@/web/api/poll'
import { ROUTES } from '@/web/api/routes'
import { pageMinute, sceneZone } from '@/web/scene/clock/clock'
import { homeMarket } from '@/web/scene/data/home'
import { alertCounts } from '@/web/scene/data/room-status'
import { locale, state } from '@/web/state/session'
import { readText } from '@/web/text/fields'
import { formatHourOfDay, zoneParts } from '@/web/text/time'
import { MINUTES_PER_HOUR, MS_PER_MINUTE } from '@/web/text/time-units'
import { tr } from '@/web/text/tr'

// The brief's and the jobs' next times move only when one runs or is edited.
const TASKS_POLL_MS = 60_000
const MINUTES_PER_DAY = 1_440
// The task whose pass checks every price alert.
export const ALERTS_TASK_NAME = 'trading.alerts'
const BRIEF_LABEL_KEY: MessageKey = 'ui.task.trading.briefs'
// The window: the last row done and the next three.
const ROWS_DONE = 1
const ROWS_SHOWN = 4
const CLOCK_SEPARATOR = ':'

/** One timed row of the day: `minute` counts from the scene's midnight today, past
 *  `MINUTES_PER_DAY` for tomorrow. */
export interface AgendaRow {
  readonly key: string
  readonly minute: number
  readonly time: string
  readonly label: string
  readonly state: 'done' | 'next' | 'todo'
  /** The agent a scheduled job runs, when the row is one. */
  readonly agentId?: string
}

/** What the two lobby screens draw; `sig` changes whenever anything drawn does. */
export interface AgendaModel {
  readonly sig: string
  readonly rows: readonly AgendaRow[]
  readonly next?: AgendaRow
  readonly untilNextMs?: number
  readonly remaining: number
  readonly watching?: number
  readonly closedLine?: string
}

interface TimedItem {
  readonly key: string
  readonly minute: number
  readonly label: string
  readonly agentId?: string
}

const tasks = signal<TasksResponse | undefined>(undefined)

/** The task that checks the price alerts; absent until `/v1/tasks` answers. */
export const alertsTask: ReadonlySignal<TaskStatusWire | undefined> = computed(() =>
  tasks.value?.tasks.find((task) => task.name === ALERTS_TASK_NAME)
)
/** The lobby agenda, recomputed once a page minute and whenever its sources change. */
export const agenda: ReadonlySignal<AgendaModel> = computed(buildAgenda)

/** Reads `/v1/tasks` now and every `TASKS_POLL_MS` while the scene is up. */
export function startAgenda(): () => void {
  return startPoll(loadTasks, TASKS_POLL_MS)
}

// A failed read keeps the last good one; before the first the agenda holds no brief row.
async function loadTasks(abortSignal: AbortSignal): Promise<void> {
  tasks.value = await getJson(ROUTES.tasks, { signal: abortSignal })
}

function buildAgenda(): AgendaModel {
  const now = pageMinute.value.minute
  const items = timedItems().sort((a, b) => a.minute - b.minute)
  const nextIndex = items.findIndex((item) => item.minute > now)
  const start = nextIndex === -1 ? items.length : Math.max(0, nextIndex - ROWS_DONE)
  const rows = items
    .slice(start, start + ROWS_SHOWN)
    .map((item) => toRow(item, items[nextIndex], now))
  const next = rows.find((row) => row.state === 'next')
  const watching = alertCounts.value.alerts
  const closedLine = closedTodayLine(homeMarket.value)
  const remaining = items.filter(
    (item) => item.minute > now && item.minute < MINUTES_PER_DAY
  ).length

  return {
    sig: [
      Math.floor(now),
      locale.value,
      watching,
      closedLine,
      ...rows.map((row) => `${row.key}${row.state}`),
    ].join('|'),
    rows,
    remaining,
    ...(next === undefined ? {} : { next, untilNextMs: (next.minute - now) * MS_PER_MINUTE }),
    ...(watching === undefined ? {} : { watching }),
    ...(closedLine === undefined ? {} : { closedLine }),
  }
}

function toRow(item: TimedItem, nextItem: TimedItem | undefined, now: number): AgendaRow {
  const clock = formatHourOfDay((item.minute % MINUTES_PER_DAY) / MINUTES_PER_HOUR)
  const isTomorrow = item.minute >= MINUTES_PER_DAY

  return {
    key: item.key,
    minute: item.minute,
    time: isTomorrow ? tr('ui.office.agenda.tomorrow', { time: clock }) : clock,
    label: item.label,
    state: rowState(item, nextItem, now),
    ...(item.agentId === undefined ? {} : { agentId: item.agentId }),
  }
}

function rowState(
  item: TimedItem,
  nextItem: TimedItem | undefined,
  now: number
): AgendaRow['state'] {
  if (item === nextItem) {
    return 'next'
  }

  return item.minute <= now ? 'done' : 'todo'
}

// Today's and tomorrow's timed rows: the brief, the scheduled jobs, the home market's session.
function timedItems(): TimedItem[] {
  const brief = tasks.value?.brief?.nextDueAt
  const briefItems =
    brief === undefined ? [] : atItems({ key: 'brief', atMs: brief, label: tr(BRIEF_LABEL_KEY) })

  return [
    ...briefItems,
    ...(state.value?.schedules ?? []).flatMap(jobItems),
    ...sessionItems(homeMarket.value),
  ]
}

function jobItems(row: ScheduleRow): TimedItem[] {
  if (row.event !== undefined || row.enabled === false || typeof row.nextRunAt !== 'number') {
    return []
  }

  const label = tr('ui.office.agenda.job', {
    agent: readText(row.agentId) ?? String(row.id),
    what: readText(row.prompt) ?? String(row.id),
  })

  const agentId = readText(row.agentId)
  const items = atItems({ key: `job:${String(row.id)}`, atMs: row.nextRunAt, label })

  return agentId === undefined ? items : items.map((item) => ({ ...item, agentId }))
}

// An instant today or tomorrow in the scene's zone; any other day is not on the screens.
function atItems(item: {
  readonly key: string
  readonly atMs: number
  readonly label: string
}): TimedItem[] {
  const parts = zoneParts(item.atMs, sceneZone.value)
  const today = pageMinute.value.day

  if (parts.day === today) {
    return [{ key: item.key, minute: parts.minute, label: item.label }]
  }

  return parts.day === nextDay(today)
    ? [{ key: item.key, minute: parts.minute + MINUTES_PER_DAY, label: item.label }]
    : []
}

// The session's times, today when it trades today and tomorrow when tomorrow is its next day.
function sessionItems(market: MarketWire | undefined): TimedItem[] {
  const session = market?.session

  if (market === undefined || session === undefined) {
    return []
  }

  const today = pageMinute.value.day
  const days = [
    ...(session.tradesToday && session.today === today ? [0] : []),
    ...(session.nextTradingDay === nextDay(today) ? [MINUTES_PER_DAY] : []),
  ]

  return days.flatMap((offset) => sessionTimes(session, market.label, offset))
}

function sessionTimes(session: MarketSessionWire, market: string, offset: number): TimedItem[] {
  const breaks = session.breaks ?? []

  return [
    {
      key: `open:${offset}`,
      minute: offset + toMinute(session.open),
      label: tr('ui.office.agenda.open', { market }),
    },
    ...breaks.flatMap((gap, i) => [
      {
        key: `break:${offset}:${i}`,
        minute: offset + toMinute(gap.from),
        label: tr('ui.office.agenda.break', { market }),
      },
      {
        key: `reopen:${offset}:${i}`,
        minute: offset + toMinute(gap.to),
        label: tr('ui.office.agenda.reopen', { market }),
      },
    ]),
    {
      key: `close:${offset}`,
      minute: offset + toMinute(session.close),
      label: tr('ui.office.agenda.close', { market }),
    },
  ]
}

function closedTodayLine(market: MarketWire | undefined): string | undefined {
  const session = market?.session

  if (market === undefined || session === undefined || session.tradesToday) {
    return undefined
  }

  return tr('ui.office.agenda.closedToday', {
    market: market.label,
    day: formatDay(locale.value, session.nextTradingDay),
  })
}

/** A session's `HH:MM` as minutes of its day. */
export function toMinute(clock: string): number {
  const [hours = 0, minutes = 0] = clock.split(CLOCK_SEPARATOR).map(Number)

  return hours * MINUTES_PER_HOUR + minutes
}

function nextDay(day: string): string {
  const next = new Date(`${day}T00:00:00Z`)

  next.setUTCDate(next.getUTCDate() + 1)

  return next.toISOString().slice(0, day.length)
}
