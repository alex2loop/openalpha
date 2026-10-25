import { type ReadonlySignal, type Signal, signal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

const MS_PER_SECOND = 1_000
const MS_PER_MINUTE = 60_000
const MINUTES_PER_HOUR = 60
const SECONDS_PER_MINUTE = 60
// Parts read in a fixed locale, so the weekday names below always match.
const ZONE_PARTS_LOCALE = 'en-GB'
const ZONE_PARTS: Intl.DateTimeFormatOptions = Object.freeze({
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})
const WEEKDAYS: readonly string[] = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
// The page reads one or two zones (the operator's and the home market's); a few spare slots cover a
// changed setting without letting the cache grow.
const MAX_ZONE_FORMATTERS = 4

/** An instant as one zone counts it: `day` is `YYYY-MM-DD`, `minute` the minutes since that day's
 *  midnight (fractional), `dow` 0 for Sunday. */
export interface ClockParts {
  readonly day: string
  readonly minute: number
  readonly dow: number
}

interface Ticker {
  readonly now: Signal<number>
  subscribers: number
  timer: ReturnType<typeof setInterval> | undefined
  visibility: AbortController | undefined
}

// One entry per distinct period, each a named constant, so the map stays a handful of entries. An
// entry is kept after its last subscriber leaves: a component rendered with its signal may subscribe
// in the same commit that another unsubscribes.
const tickers = new Map<number, Ticker>()
const zoneFormatters = new Map<string, Intl.DateTimeFormat>()

/** The current epoch ms, refreshed every `everyMs` by one interval shared by every caller of that
 *  period. A hidden tab clears it; on return it ticks once at once and re-arms. */
export function useNow(everyMs: number): ReadonlySignal<number> {
  const ticker = resolveTicker(everyMs)

  useEffect(() => subscribe(everyMs), [everyMs])

  return ticker.now
}

function resolveTicker(everyMs: number): Ticker {
  const held = tickers.get(everyMs)

  if (held !== undefined) {
    return held
  }

  const ticker: Ticker = {
    now: signal(Date.now()),
    subscribers: 0,
    timer: undefined,
    visibility: undefined,
  }

  tickers.set(everyMs, ticker)

  return ticker
}

function subscribe(everyMs: number): () => void {
  const ticker = resolveTicker(everyMs)

  ticker.subscribers++

  if (ticker.subscribers === 1) {
    // A reused entry still holds the time its last subscriber left with.
    ticker.now.value = Date.now()

    const visibility = new AbortController()

    ticker.visibility = visibility
    document.addEventListener('visibilitychange', () => syncTimer(ticker, everyMs), {
      signal: visibility.signal,
    })
    syncTimer(ticker, everyMs)
  }

  return () => unsubscribe(ticker)
}

function unsubscribe(ticker: Ticker): void {
  ticker.subscribers--

  if (ticker.subscribers > 0) {
    return
  }

  ticker.visibility?.abort()
  clearInterval(ticker.timer)
  ticker.timer = undefined
}

function syncTimer(ticker: Ticker, everyMs: number): void {
  clearInterval(ticker.timer)
  ticker.timer = undefined

  if (document.hidden) {
    return
  }

  ticker.now.value = Date.now()
  ticker.timer = setInterval(() => {
    ticker.now.value = Date.now()
  }, everyMs)
}

/** Where `epochMs` falls in `timeZone`; a zone this browser does not know reads in its own zone. */
export function zoneParts(epochMs: number, timeZone: string): ClockParts {
  const parts = resolveZoneFormatter(timeZone).formatToParts(epochMs)
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''
  const minute =
    Number(read('hour')) * MINUTES_PER_HOUR +
    Number(read('minute')) +
    Number(read('second')) / SECONDS_PER_MINUTE +
    (epochMs % MS_PER_SECOND) / MS_PER_MINUTE

  return {
    day: `${read('year')}-${read('month')}-${read('day')}`,
    minute,
    dow: Math.max(0, WEEKDAYS.indexOf(read('weekday'))),
  }
}

function resolveZoneFormatter(timeZone: string): Intl.DateTimeFormat {
  const held = zoneFormatters.get(timeZone)

  if (held !== undefined) {
    return held
  }

  const oldest = zoneFormatters.keys().next()

  if (zoneFormatters.size >= MAX_ZONE_FORMATTERS && oldest.done !== true) {
    zoneFormatters.delete(oldest.value)
  }

  const format = buildZoneFormatter(timeZone)

  zoneFormatters.set(timeZone, format)

  return format
}

function buildZoneFormatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(ZONE_PARTS_LOCALE, { ...ZONE_PARTS, timeZone })
  } catch {
    return new Intl.DateTimeFormat(ZONE_PARTS_LOCALE, ZONE_PARTS)
  }
}
