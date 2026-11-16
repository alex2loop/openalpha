import { z } from 'zod'

import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { EarningsTiming, MarketEvent } from '@/trading/kernel/market/market-event'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceFetchOutcome } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { daysSinceMonday, MS_PER_HOUR, MS_PER_SECOND } from '@/core/utils/time'
import { shiftCalendarDay } from '@/trading/markets/calendar'
import {
  NASDAQ_EARNINGS_ID,
  NASDAQ_HEADERS,
  NASDAQ_TIMEZONE,
  parseSignedUsd,
  USD,
} from '@/trading/sources/adapters/nasdaq/client'
import { createCachedReader } from '@/trading/sources/cached-reader'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  dayFromEpochSeconds,
  dropInvalid,
  fromCodeTable,
  isIssuerEventRequest,
  parseRow,
} from '@/trading/sources/rows/normalization'

/** Calendar days ahead of today the calendar fills, measured: it holds about five weeks of pages and
 *  answers a later day with no record, so asking past this would only fetch emptiness. */
const EARNINGS_LOOKAHEAD_DAYS = 21
/** A day's reports move little once listed; a few hours keeps a brief's many names on one page read. */
const EARNINGS_PAGE_TTL_MS = 3 * MS_PER_HOUR
const EARNINGS_PAGE_CONCURRENCY = 4
const OK_CODE = 200
/** What the calendar answers, beside a null body, for a day it holds no page for. */
const NO_RECORD_CODE = 1002
/** `daysSinceMonday` of Saturday: measured, the calendar lists no report on a weekend. */
const FIRST_DARK_DAY = 5

const TIMINGS = Object.freeze({
  'time-pre-market': 'pre-market',
  'time-after-hours': 'after-close',
} as const satisfies Readonly<Record<string, EarningsTiming>>)

/** The English a model reads in an event's title; a person reads the catalog's wording. */
const TIMING_WORDS = Object.freeze({
  'pre-market': 'before the open',
  'after-close': 'after the close',
} as const satisfies Readonly<Record<EarningsTiming, string>>)

const PAGE = z.object({
  data: z.object({ rows: z.array(z.unknown()).nullable() }).nullable(),
  status: z.object({
    rCode: z.number(),
    bCodeMessage: z.array(z.object({ code: z.number() })).nullable(),
  }),
})

const ROW = z.object({
  symbol: z.string().min(1),
  time: z.string(),
  epsForecast: z.string(),
})

interface EarningsRow {
  readonly symbol: string
  readonly at: TradingDay
  readonly timing?: EarningsTiming
  readonly epsForecast?: number
}

/** Upcoming reports come from the calendar's per-day pages: the per-symbol endpoint answers in
 *  prose. One page serves every name asking for that day, so a brief over many names costs one read
 *  per day. A day the calendar cannot answer fails the whole read, because a missing day would read
 *  as "no report". */
export function nasdaqEarningsSource(options: SourceAdapterOptions): RegisteredSource {
  const readPage = createCachedReader<TradingDay, readonly EarningsRow[]>({
    ttlMs: EARNINGS_PAGE_TTL_MS,
    maxEntries: EARNINGS_LOOKAHEAD_DAYS + 1,
    load: (day, signal) =>
      options.http.getJson(
        {
          sourceId: NASDAQ_EARNINGS_ID,
          path: '/api/calendar/earnings',
          query: { date: day },
          headers: NASDAQ_HEADERS,
          signal,
        },
        (raw) => parsePage(raw, day)
      ),
  })

  return createSource({
    id: NASDAQ_EARNINGS_ID,
    kind: 'events',
    http: options.http,
    covers: isIssuerEventRequest,
    load: async (context, signal) => {
      const { instrument } = context

      if (instrument === undefined) {
        return { kind: 'error', code: 'source.symbol-not-found' }
      }

      const now = Date.now()
      const days = reportingDays(context, dayFromEpochSeconds(now / MS_PER_SECOND, NASDAQ_TIMEZONE))
      const pages = await mapWithConcurrency(days, EARNINGS_PAGE_CONCURRENCY, (day) =>
        readPage(day, signal)
      )

      return toEarningsEvents(pages, { instrument, now })
    },
  })
}

/** The days the calendar can answer inside the asked window: today on, never past its reach, and
 *  not the weekend. */
function reportingDays(context: SourceContext, today: TradingDay): readonly TradingDay[] {
  const reach = shiftCalendarDay(today, EARNINGS_LOOKAHEAD_DAYS)
  const first = context.fromDay === undefined || context.fromDay < today ? today : context.fromDay
  const last = context.toDay === undefined || context.toDay > reach ? reach : context.toDay
  const days: TradingDay[] = []

  for (let day = first; day <= last; day = shiftCalendarDay(day, 1)) {
    if (daysSinceMonday(day) < FIRST_DARK_DAY) {
      days.push(day)
    }
  }

  return days
}

/** A page's rows, or none for a day with nothing listed. A body that is neither is a payload this
 *  adapter cannot read, never an empty day. */
function parsePage(raw: unknown, day: TradingDay): readonly EarningsRow[] {
  const page = parseRow(PAGE, raw, 'nasdaq earnings')

  if (page.status.rCode !== OK_CODE) {
    throw new ValidationError('nasdaq earnings page was refused')
  }

  if (page.data !== null) {
    return dropInvalid(page.data.rows ?? [], (row) => toRow(row, day))
  }

  if (page.status.bCodeMessage?.some((message) => message.code === NO_RECORD_CODE) === true) {
    return []
  }

  throw new ValidationError('nasdaq earnings page carries no data')
}

function toRow(raw: unknown, at: TradingDay): EarningsRow {
  const row = parseRow(ROW, raw, 'nasdaq earnings')
  const timing = fromCodeTable(TIMINGS, row.time)
  const epsForecast = forecastOf(row.epsForecast)

  return {
    symbol: row.symbol,
    at,
    ...(timing === undefined ? {} : { timing }),
    ...(epsForecast === undefined ? {} : { epsForecast }),
  }
}

function forecastOf(raw: string): number | undefined {
  try {
    return parseSignedUsd(raw)
  } catch {
    // "" or "N/A": no analyst has put a figure on it, which is not a forecast of zero.
    return undefined
  }
}

interface EarningsRead {
  readonly instrument: InstrumentRef
  readonly now: number
}

function toEarningsEvents(
  pages: readonly SourceFetchOutcome<readonly EarningsRow[]>[],
  read: EarningsRead
): SourceFetchOutcome<ParsedSource<readonly MarketEvent[]>> {
  const rows: EarningsRow[] = []
  let fetchedAt = read.now

  for (const page of pages) {
    if (page.kind === 'error') {
      return page
    }

    rows.push(...page.value)
    fetchedAt = Math.min(fetchedAt, page.fetchedAt)
  }

  const events = rows
    .filter((row) => row.symbol === read.instrument.ticker)
    .map((row) => toEvent(row, read.instrument))

  return { kind: 'ok', value: parsedSource(events), fetchedAt }
}

function toEvent(row: EarningsRow, instrument: InstrumentRef): MarketEvent {
  const { timing, epsForecast } = row
  const words = timing === undefined ? '' : ` ${TIMING_WORDS[timing]}`

  return {
    at: row.at,
    kind: 'earnings-date',
    title: `${row.symbol} reports earnings${words}`,
    composedText: true,
    instrument,
    earnings: {
      ...(timing === undefined ? {} : { timing }),
      ...(epsForecast === undefined ? {} : { epsForecast }),
      currency: USD,
    },
    ...(epsForecast === undefined ? {} : { detail: forecastText(epsForecast) }),
  }
}

function forecastText(epsForecast: number): string {
  return `EPS forecast ${epsForecast < 0 ? '-' : ''}$${Math.abs(epsForecast)}`
}
