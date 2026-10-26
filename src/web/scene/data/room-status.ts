import { computed, type ReadonlySignal, signal } from '@preact/signals'

import type { StopsResponse } from '@/app/server/wire/money'
import type { RoomId } from '@/web/scene/types'
import { translateDisplayText } from '@/i18n'
import { getJson } from '@/web/api/client'
import { startPoll } from '@/web/api/poll'
import { ROUTES } from '@/web/api/routes'
import { createSingleFlight } from '@/web/api/single-flight'
import { onWireEvent } from '@/web/state/events'
import { pending, type Run, runs } from '@/web/state/live'
import { locale } from '@/web/state/session'
import { tr } from '@/web/text/tr'

// A fired alert or a broken stop reads the counts again at once; this is the backstop.
const ALERTS_POLL_MS = 60_000
// The answer carries the active count of the whole book; the page's rows name the markets watched,
// up to the daemon's own cap.
const ALERTS_PAGE_LIMIT = 100
// The command or agent behind a run, and the room its crew works in.
const RUN_ROOMS: Readonly<Record<string, RoomId>> = Object.freeze({
  refresh: 'store',
  research: 'lib',
  suggest: 'meet',
  debate: 'meet',
  brief: 'meet',
  chat: 'assist',
})
// The progress parameter that names what a room's run is about.
const DEBATE_STEP_PREFIX = 'trading.progress.debate.'
// The research step at which the library's printer runs.
const PRINT_STEP_KEY = 'progress.researchStageSynthesize'
const SUBJECT_PARAMS: Readonly<Partial<Record<RoomId, string>>> = Object.freeze({
  store: 'market',
  lib: 'topic',
  meet: 'ticker',
})

/** What a room is busy with: its runs oldest first (the first is its focus run), what the focus run
 *  is about, and the room's own counts. A count the daemon has not sent is absent, never zero. */
export interface RoomStatus {
  readonly runs: readonly Run[]
  readonly subject?: string
  readonly waiting?: number
  readonly alerts?: number
  readonly stops?: number
  readonly markets?: ReadonlySet<string>
}

type StopRow = StopsResponse['stops'][number]

/** A holding whose mark is through its plan's stop. */
export type BreachedStop = StopRow['instrument']

interface AlertCounts {
  readonly alerts?: number
  readonly stops?: number
  /** The markets the alerts and planned stops are on. */
  readonly markets?: ReadonlySet<string>
}

const counts = signal<AlertCounts>({})
const breached = signal<readonly BreachedStop[] | undefined>(undefined)

/** Active price alerts and planned stops, and the markets they watch; each absent until read. */
export const alertCounts: ReadonlySignal<AlertCounts> = counts
/** The holdings `/v1/stops` shows through their stop; absent until read. A fund's review level is
 *  not a stop and never counts. */
export const breachedStops: ReadonlySignal<readonly BreachedStop[] | undefined> = breached
/** Every room with something to say, keyed by room. */
export const roomStatus: ReadonlySignal<ReadonlyMap<RoomId, RoomStatus>> = computed(buildStatus)
/** What the meeting room's and the library's whiteboards say while a run counts its steps there. */
export const boardCaptions: ReadonlySignal<Partial<Record<RoomId, string>>> = computed(() => {
  const status = roomStatus.value
  const meet = debateLine(status.get('meet')?.runs[0])
  const lib = questionLine(status.get('lib')?.runs[0]?.progress?.params)

  return {
    ...(meet === undefined ? {} : { meet }),
    ...(lib === undefined ? {} : { lib }),
  }
})

/** The room a run's crew works in, running or finished; a run the page cannot place has none. */
export function roomOfRun(run: Pick<Run, 'name' | 'parentRunId' | 'hidden'>): RoomId | undefined {
  if (run.hidden === true || run.parentRunId !== undefined) {
    return undefined
  }

  return RUN_ROOMS[run.name]
}

/** Reads the alert desk's counts now, on every fired alert or broken stop, and every
 *  `ALERTS_POLL_MS`. The returned stop is idempotent. */
export function startRoomStatus(): () => void {
  const lifetime = new AbortController()
  const refetch = createSingleFlight(loadCounts, lifetime.signal)
  // `refetch` never rejects: `loadCounts` keeps the last good counts on a failure.
  const onChange = (): void => {
    refetch().catch(() => undefined)
  }
  const offs = [onWireEvent('alert_fired', onChange), onWireEvent('stop_breached', onChange)]
  const stopPoll = startPoll(() => refetch(), ALERTS_POLL_MS)

  return () => {
    lifetime.abort()
    stopPoll()

    for (const off of offs) {
      off()
    }
  }
}

function buildStatus(): ReadonlyMap<RoomId, RoomStatus> {
  const byRoom = new Map<RoomId, RoomStatus>()

  for (const run of [...runs.value].sort((a, b) => a.startedAt - b.startedAt)) {
    const room = roomOfRun(run)

    if (room !== undefined) {
      const held = byRoom.get(room)

      byRoom.set(
        room,
        held === undefined ? withSubject(room, run) : { ...held, runs: [...held.runs, run] }
      )
    }
  }

  const waiting = pending.value.filter((entry) => entry.kind === 'approval').length

  byRoom.set('desk', { runs: byRoom.get('desk')?.runs ?? [], waiting })
  byRoom.set('alerts', { runs: byRoom.get('alerts')?.runs ?? [], ...counts.value })

  return byRoom
}

function withSubject(room: RoomId, run: Run): RoomStatus {
  const name = SUBJECT_PARAMS[room]
  const subject =
    name === undefined ? undefined : (toParamText(run.progress?.params?.[name]) ?? run.tickers[0])

  return subject === undefined ? { runs: [run] } : { runs: [run], subject }
}

/** A progress parameter as text: plain text, a number, or a keyed message worded in the page's
 *  language; anything else is absent. */
export function toParamText(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'key' in value &&
    typeof value.key === 'string'
  ) {
    return translateDisplayText(locale.value, { key: value.key })
  }

  return undefined
}

async function loadCounts(abortSignal: AbortSignal): Promise<void> {
  try {
    const [alerts, stops] = await Promise.all([
      getJson(ROUTES.alerts, { query: { limit: ALERTS_PAGE_LIMIT }, signal: abortSignal }),
      getJson(ROUTES.stops, { signal: abortSignal }),
    ])

    const planned = stops.stops.filter((stop) => stop.plan === 'distance')
    const active = alerts.alerts.filter((alert) => alert.state === 'active')

    counts.value = {
      alerts: alerts.activeCount,
      stops: planned.length,
      markets: new Set([...active, ...planned].map((row) => row.instrument.market)),
    }
    breached.value = stops.stops.filter(isBreached).map((stop) => stop.instrument)
  } catch {
    // The last good counts stay; before the first read the desk names none.
  }
}

function isBreached(stop: StopRow): boolean {
  return (
    stop.plan === 'distance' &&
    !stop.review &&
    stop.distanceToStopPct !== undefined &&
    stop.distanceToStopPct <= 0
  )
}

/** The library's run is at the step that prints its report. */
export function isPrintingRun(run: Run | undefined): boolean {
  return run?.progress?.key === PRINT_STEP_KEY
}

/** The meeting whiteboard's line: the focus run's debate round, when it is in one. */
export function debateLine(run: Run | undefined): string | undefined {
  const progress = run?.progress

  if (progress === undefined || !progress.key.startsWith(DEBATE_STEP_PREFIX)) {
    return undefined
  }

  const ticker = toParamText(progress.params?.ticker) ?? run?.tickers[0]
  const n = toParamText(progress.params?.step)
  const total = toParamText(progress.params?.total)

  return ticker === undefined || n === undefined || total === undefined
    ? undefined
    : tr('ui.office.board.meet', { ticker, n, total })
}

/** The library board's line: the question the research is on, of how many. */
export function questionLine(
  params: Readonly<Record<string, unknown>> | undefined
): string | undefined {
  const n = toParamText(params?.index ?? params?.done)
  const total = toParamText(params?.total)

  return n === undefined || total === undefined
    ? undefined
    : tr('ui.office.board.lib', { n, total })
}
