import type { MarketSessionWire, MarketWire } from '@/app/server/wire/market'
import type { ScheduleRow } from '@/app/server/wire/system'
import type { AgentView } from '@/web/ui/agent/agent-view'
import { useNow } from '@/web/state/clock'
import { knownMarkets } from '@/web/state/market'
import { state } from '@/web/state/session'
import { joinInline } from '@/web/text/glyphs'
import { formatRunName } from '@/web/text/run-name'
import { buildDayKey, formatClock } from '@/web/text/time'
import { HOURS_PER_DAY } from '@/web/text/time-units'
import { tr } from '@/web/text/tr'

const NOW_TICK_MS = 60_000
const STRIP_W = 340
const STRIP_H = 46
const STRIP_PAD = 4
const BAR_Y = 12
const BAR_H = 14
const SHADE_Y = 10
const SHADE_H = 18
const WAIT_Y = 31
const NOW_TOP = 6
const NOW_BOTTOM = 32
const LABEL_Y = 44
const MIN_BAR_W = 3
const NEXT_BAR_W = 4
const MINUTES_PER_HOUR = 60
const HOUR_MARKS = [0, 6, 12, 18, 24] as const
const HALF_DAY = HOURS_PER_DAY / 2

interface Span {
  readonly from: number
  readonly to: number
}

interface DayStripProps {
  readonly view: AgentView
  /** The agent's own schedules. */
  readonly schedules: readonly ScheduleRow[]
}

interface StripBar {
  readonly key: string
  readonly span: Span
  readonly title: string
  readonly isRunning: boolean
}

/** "Nhịp hôm nay": the daemon's 24 hours, the exchange session shaded, the runs that ended dark and
 *  the one working darker, the next run today outlined, a dotted line while an event schedule waits,
 *  and a red mark at now. */
export function DayStrip({ view, schedules }: DayStripProps) {
  const now = useNow(NOW_TICK_MS).value
  const timeZone = state.value?.timeZone

  if (timeZone === undefined) {
    return null
  }

  const session = resolveSession(view)
  const shaded = session === undefined ? [] : toSessionSpans(session, { now, timeZone })
  const next = findNextToday(schedules, { now, timeZone })
  const nowX = toX(clockHour(now, timeZone))

  return (
    <svg
      class="day-strip"
      viewBox={`0 0 ${STRIP_W} ${STRIP_H}`}
      role="img"
      aria-label={tr('ui.office.agent.rhythm')}
    >
      <SessionShade spans={shaded} />
      {isEventWaiting(schedules) && <WaitLine spans={shaded} />}
      {buildBars(view, { now, timeZone }).map((bar) => (
        <RunBar key={bar.key} bar={bar} />
      ))}
      {next !== undefined && (
        <rect
          class="day-next"
          x={toX(clockHour(next, timeZone))}
          y={BAR_Y}
          width={NEXT_BAR_W}
          height={BAR_H}
        />
      )}
      <line class="day-now" x1={nowX} x2={nowX} y1={NOW_TOP} y2={NOW_BOTTOM} />
      <HourLabels />
    </svg>
  )
}

/** The line under the strip: runs done and running, what comes next, what it waits for. */
export function DayCount({
  view,
  schedules,
  seconds,
}: DayStripProps & { readonly seconds: string | number }) {
  const timeZone = state.value?.timeZone
  const now = useNow(NOW_TICK_MS).value
  const next = timeZone === undefined ? undefined : findNextToday(schedules, { now, timeZone })
  const running = view.run === undefined ? 0 : 1
  const done = view.rows.length
  const isWaiting = isEventWaiting(schedules)

  return (
    <p class="meta">
      {joinInline([
        done + running === 0
          ? tr('ui.office.agent.rhythmNone')
          : tr('ui.office.agent.rhythmCount', { done, running }),
        ...(next === undefined || timeZone === undefined
          ? []
          : [tr('ui.office.agent.rhythmNext', { when: formatClock(next, timeZone) })]),
        ...(isWaiting ? [tr('ui.office.agent.rhythmWaiting', { seconds })] : []),
      ])}
    </p>
  )
}

function SessionShade({ spans }: { readonly spans: readonly Span[] }) {
  return (
    <>
      {spans.map((span) => (
        <rect
          key={span.from}
          class="day-shade"
          x={toX(span.from)}
          y={SHADE_Y}
          width={toX(span.to) - toX(span.from)}
          height={SHADE_H}
        />
      ))}
    </>
  )
}

function RunBar({ bar }: { readonly bar: StripBar }) {
  const { span } = bar

  return (
    <rect
      class={bar.isRunning ? 'day-run is-running' : 'day-run'}
      x={toX(span.from)}
      y={BAR_Y}
      width={Math.max(MIN_BAR_W, toX(span.to) - toX(span.from))}
      height={BAR_H}
    >
      <title>{bar.title}</title>
    </rect>
  )
}

function HourLabels() {
  return (
    <>
      {HOUR_MARKS.map((hour) => (
        <text key={hour} class="day-label" x={toX(hour)} y={LABEL_Y} text-anchor={anchorOf(hour)}>
          {String(hour).padStart(2, '0')}
        </text>
      ))}
    </>
  )
}

// A run that began before midnight starts the strip at 00.
function buildBars(
  view: AgentView,
  clock: { readonly now: number; readonly timeZone: string }
): readonly StripBar[] {
  const { now, timeZone } = clock
  const day = buildDayKey(now, timeZone)
  const hourOf = (at: number): number =>
    buildDayKey(at, timeZone) === day ? clockHour(at, timeZone) : 0
  const done = view.rows.map((row) => ({
    key: row.runId,
    span: { from: hourOf(row.startedAt), to: hourOf(row.endedAt) },
    title: formatRunName(row),
    isRunning: false,
  }))
  const { run } = view

  return run === undefined
    ? done
    : [
        ...done,
        {
          key: run.runId,
          span: { from: hourOf(run.startedAt), to: clockHour(now, timeZone) },
          title: formatRunName(run),
          isRunning: true,
        },
      ]
}

function isEventWaiting(schedules: readonly ScheduleRow[]): boolean {
  return schedules.some((row) => row.event !== undefined && row.enabled !== false)
}

// Under the session while there is one, else across the day: the alert pass checks all day long.
function WaitLine({ spans }: { readonly spans: readonly Span[] }) {
  const from = spans[0]?.from ?? 0
  const to = spans.at(-1)?.to ?? HOURS_PER_DAY

  return <line class="day-wait" x1={toX(from)} x2={toX(to)} y1={WAIT_Y} y2={WAIT_Y} />
}

function toX(hour: number): number {
  return STRIP_PAD + (hour * (STRIP_W - 2 * STRIP_PAD)) / HOURS_PER_DAY
}

function anchorOf(hour: number): 'start' | 'middle' | 'end' {
  if (hour === 0) {
    return 'start'
  }

  return hour === HOURS_PER_DAY ? 'end' : 'middle'
}

/** The hour of the day an instant shows on `timeZone`'s clock, with its minutes as a fraction. */
function clockHour(at: number, timeZone: string): number {
  return parseClock(formatClock(at, timeZone))
}

function parseClock(clock: string): number {
  const [hours = 0, minutes = 0] = clock.split(':').map(Number)

  return hours + minutes / MINUTES_PER_HOUR
}

// The first market it follows that has a session, else the home market; one that never closes has
// none, and nothing is shaded.
function resolveSession(view: AgentView): MarketSessionWire | undefined {
  const markets = knownMarkets.value
  const followed = view.agent?.focus?.markets ?? []
  const own = followed.flatMap((id) => markets.filter((held: MarketWire) => held.market === id))
  const market =
    own.find((held) => held.session !== undefined) ?? markets.find((held) => held.ownsRegion)

  return market?.session?.tradesToday === true ? market.session : undefined
}

// The session's open stretches, moved from the exchange's clock onto the daemon's.
function toSessionSpans(
  session: MarketSessionWire,
  clock: { readonly now: number; readonly timeZone: string }
): readonly Span[] {
  const shift = zoneShift(clock.now, { from: session.timeZone, to: clock.timeZone })
  const cuts = (session.breaks ?? []).flatMap((pause) => [
    parseClock(pause.from),
    parseClock(pause.to),
  ])
  const edges = [parseClock(session.open), ...cuts, parseClock(session.close)].map(
    (hour) => hour + shift
  )
  const spans: Span[] = []

  for (let index = 0; index + 1 < edges.length; index += 2) {
    spans.push({ from: clampHour(edges[index] ?? 0), to: clampHour(edges[index + 1] ?? 0) })
  }

  return spans
}

// How many hours `to`'s clock runs ahead of `from`'s right now, within half a day either way.
function zoneShift(now: number, zones: { readonly from: string; readonly to: string }): number {
  const raw = clockHour(now, zones.to) - clockHour(now, zones.from)

  if (raw > HALF_DAY) {
    return raw - HOURS_PER_DAY
  }

  return raw <= -HALF_DAY ? raw + HOURS_PER_DAY : raw
}

function clampHour(hour: number): number {
  return Math.min(HOURS_PER_DAY, Math.max(0, hour))
}

// A timed schedule's next run, when it falls later today on the daemon's calendar.
function findNextToday(
  schedules: readonly ScheduleRow[],
  clock: { readonly now: number; readonly timeZone: string }
): number | undefined {
  const day = buildDayKey(clock.now, clock.timeZone)
  const times = schedules.flatMap((row) =>
    row.enabled !== false &&
    typeof row.nextRunAt === 'number' &&
    row.nextRunAt > clock.now &&
    buildDayKey(row.nextRunAt, clock.timeZone) === day
      ? [row.nextRunAt]
      : []
  )

  return times.length === 0 ? undefined : Math.min(...times)
}
