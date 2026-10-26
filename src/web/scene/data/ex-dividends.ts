import { computed, effect, type ReadonlySignal, signal, untracked } from '@preact/signals'

import type { InstrumentRefWire } from '@/app/server/wire/trading'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { pageMinute } from '@/web/scene/clock/clock'
import { marketList } from '@/web/scene/data/home'
import { heldPositions, keyOf } from '@/web/state/market'
import { shiftDay } from '@/web/text/time-units'

/** The most held names whose events are read, once each a day. */
const MAX_EVENT_READS = 20
const EVENTS_WINDOW_DAYS = 14
const EX_DIVIDEND_KIND = 'dividend-ex-date'
const KEY_SEPARATOR = '|'

/** A held name's ex-dividend date, `day` as `YYYY-MM-DD`. */
interface ExDate {
  readonly ticker: string
  readonly market: string
  readonly day: string
}

const dates = signal<readonly ExDate[]>([])
const today = computed(() => pageMinute.value.day)

/** The ex-dividend dates of the held names over the next days, soonest first. */
export const exDividends: ReadonlySignal<readonly ExDate[]> = dates
/** The held names that go ex-dividend today on the page clock. */
export const exDividendToday: ReadonlySignal<readonly ExDate[]> = computed(() =>
  dates.value.filter((held) => held.day === today.value)
)
/** The soonest ex-dividend date from today on; absent when none is known. */
export const nextExDate: ReadonlySignal<ExDate | undefined> = computed(() =>
  dates.value.find((held) => held.day >= today.value)
)

/** Reads the held names' events when the day or the names change, never more than once for the
 *  same day and names; a failed read is not tried again before one of them changes. The returned
 *  stop aborts a read under way and empties the dates. */
export function startExDividends(): () => void {
  let readKey = ''
  let running: AbortController | undefined
  const stop = effect(() => {
    const day = today.value
    const names = namesOf(heldPositions.value.map((held) => held.instrument))
    const key = [day, ...names.map(keyOf)].join(KEY_SEPARATOR)

    if (key === readKey) {
      return
    }

    readKey = key
    running?.abort()

    const controller = new AbortController()

    running = controller
    // `readDates` never rejects: a failed read keeps the last good one.
    untracked(() => readDates(names, { day, signal: controller.signal })).catch(() => undefined)
  })

  return () => {
    stop()
    running?.abort()
    dates.value = []
  }
}

// The held names an event source covers, at most `MAX_EVENT_READS`.
function namesOf(held: readonly InstrumentRefWire[]): InstrumentRefWire[] {
  const markets = marketList.value

  return held
    .filter((name) => markets.find((market) => market.market === name.market)?.hasEvents === true)
    .slice(0, MAX_EVENT_READS)
}

async function readDates(
  names: readonly InstrumentRefWire[],
  at: { readonly day: string; readonly signal: AbortSignal }
): Promise<void> {
  const toDay = shiftDay(at.day, EVENTS_WINDOW_DAYS)
  const settled = await Promise.allSettled(
    names.map((name) =>
      getJson(ROUTES.events, {
        query: { ...name, fromDay: at.day, toDay },
        signal: at.signal,
      })
    )
  )

  if (at.signal.aborted || (names.length > 0 && settled.every((r) => r.status === 'rejected'))) {
    return
  }

  dates.value = settled
    .flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
    .flatMap((answer) =>
      answer.events
        .filter((event) => event.kind === EX_DIVIDEND_KIND && event.at >= at.day)
        .map((event) => ({ ticker: answer.ticker, market: answer.market, day: event.at }))
    )
    .sort((a, b) => a.day.localeCompare(b.day))
}
