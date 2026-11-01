import { type ReadonlySignal, signal } from '@preact/signals'

import type { ProgressWire } from '@/app/server/wire/live'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { setCapped } from '@/web/state/capped-map'
import { onWireEvent } from '@/web/state/events'
import { shiftDay } from '@/web/text/time-units'

/** The step a research question reports while it searches or reads a page. */
export const QUESTION_ACTIVITY_KEY = 'progress.researchQuestionActivity'
/** The activity keys of a page read (one page or a batch). */
export const FETCH_ACTIVITY_PREFIX = 'progress.researchOperationFetch'

const MAX_SCREEN_HOSTS = 20
// Runs whose hosts are kept at once; each run's list leaves at its `run_finished`.
const MAX_HOST_RUNS = 8
const MAX_SCREEN_SERIES = 20
// How many closes a desk's price line draws.
const SCREEN_CLOSES = 30
// Calendar days that hold the last `SCREEN_CLOSES` sessions, weekends and holidays included.
const SERIES_LOOKBACK_DAYS = 60
// A line needs two points.
const MIN_CLOSES = 2

/** What a desk's price line is of. */
export interface SeriesRef {
  readonly runId: string
  readonly market: string
  readonly ticker: string
  /** The page day the read ends on, `YYYY-MM-DD`. */
  readonly day: string
}

const hostLists = signal<ReadonlyMap<string, readonly string[]>>(new Map())
const seriesReads = signal<ReadonlyMap<string, readonly number[]>>(new Map())
// Reads asked for, kept as long as their answers, so one run and ticker is read once.
const askedSeries = new Map<string, true>()
let lifetime: AbortController | undefined

/** The hosts each research run has read since the page saw it, oldest first, by `runId`. */
export const screenHosts: ReadonlySignal<ReadonlyMap<string, readonly string[]>> = hostLists
/** The last closes read for a run's ticker, by `seriesKeyOf`. */
export const screenSeries: ReadonlySignal<ReadonlyMap<string, readonly number[]>> = seriesReads

/** Follows the page reads research runs report and keeps the price lines asked for; a run's
 *  entries leave at its `run_finished`. The returned stop is idempotent. */
export function startDeskReads(): () => void {
  const reads = new AbortController()
  const offs = [
    onWireEvent('run_progress', (event) => noteHost(event.runId, event.progress)),
    onWireEvent('run_finished', (event) => forgetRun(event.runId)),
  ]

  lifetime = reads

  return () => {
    reads.abort()

    for (const off of offs) {
      off()
    }

    if (lifetime === reads) {
      lifetime = undefined
    }

    askedSeries.clear()
    hostLists.value = new Map()
    seriesReads.value = new Map()
  }
}

/** The host a question's page read names; a search or any other step names none. */
export function hostOf(progress: ProgressWire | undefined): string | undefined {
  if (progress?.key !== QUESTION_ACTIVITY_KEY) {
    return undefined
  }

  const activity = progress.params?.activity

  if (typeof activity !== 'object' || activity === null || !('key' in activity)) {
    return undefined
  }

  const detail = 'params' in activity ? readDetail(activity.params) : undefined
  const isFetch = typeof activity.key === 'string' && activity.key.startsWith(FETCH_ACTIVITY_PREFIX)

  return isFetch && detail !== undefined && detail !== '' ? detail : undefined
}

export function seriesKeyOf(ref: Pick<SeriesRef, 'runId' | 'ticker'>): string {
  return `${ref.runId}:${ref.ticker}`
}

/** Reads the last closes of `ref`'s ticker once per run and ticker; a failed read draws no line. */
export function requestSeries(ref: SeriesRef): void {
  const key = seriesKeyOf(ref)
  const reads = lifetime

  if (reads === undefined || askedSeries.has(key)) {
    return
  }

  setCapped(askedSeries, [key, true], MAX_SCREEN_SERIES)
  loadSeries(ref, reads.signal).catch(() => undefined)
}

function readDetail(params: unknown): string | undefined {
  return typeof params === 'object' &&
    params !== null &&
    'detail' in params &&
    typeof params.detail === 'string'
    ? params.detail
    : undefined
}

function noteHost(runId: string | undefined, progress: ProgressWire | undefined): void {
  const host = hostOf(progress)

  if (runId === undefined || host === undefined) {
    return
  }

  const held = hostLists.value.get(runId) ?? []

  if (held.includes(host)) {
    return
  }

  const next = new Map(hostLists.value)

  setCapped(next, [runId, [...held, host].slice(-MAX_SCREEN_HOSTS)], MAX_HOST_RUNS)
  hostLists.value = next
}

function forgetRun(runId: string | undefined): void {
  if (runId === undefined) {
    return
  }

  if (hostLists.value.has(runId)) {
    const next = new Map(hostLists.value)

    next.delete(runId)
    hostLists.value = next
  }

  const prefix = `${runId}:`

  for (const key of askedSeries.keys()) {
    if (key.startsWith(prefix)) {
      askedSeries.delete(key)
    }
  }

  if ([...seriesReads.value.keys()].some((key) => key.startsWith(prefix))) {
    seriesReads.value = new Map([...seriesReads.value].filter(([key]) => !key.startsWith(prefix)))
  }
}

async function loadSeries(ref: SeriesRef, abortSignal: AbortSignal): Promise<void> {
  const key = seriesKeyOf(ref)

  try {
    const read = await getJson(ROUTES.ohlcv, {
      query: {
        market: ref.market,
        ticker: ref.ticker,
        fromDay: shiftDay(ref.day, -SERIES_LOOKBACK_DAYS),
        toDay: ref.day,
      },
      signal: abortSignal,
    })
    const closes = read.bars.map((bar) => bar.close).slice(-SCREEN_CLOSES)

    if (closes.length >= MIN_CLOSES && askedSeries.has(key)) {
      const next = new Map(seriesReads.value)

      setCapped(next, [key, closes], MAX_SCREEN_SERIES)
      seriesReads.value = next
    }
  } catch {
    // No line: the desk's screen stays dark rather than drawing a series it could not read.
  }
}
