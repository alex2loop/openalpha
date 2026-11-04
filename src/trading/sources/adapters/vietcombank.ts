// Source class: scraping-risky. `www.vietcombank.com.vn/api/exchangerates` is the bank's own website
// feed — undocumented and with no SLA, so it can change or refuse traffic without notice. The
// endpoint is code-owned because it is a provider fact.
import { z } from 'zod'

import type { TradingDay } from '@/trading/kernel/instrument'
import type { FxRatePoint } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceFetchOutcome, SourceHttp } from '@/trading/sources/types'
import { daysSinceMonday, MS_PER_DAY } from '@/core/utils/time'
import { sourceId } from '@/trading/kernel/source/source-id'
import { shiftCalendarDay } from '@/trading/markets/calendar'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  dropInvalid,
  parseRow,
  positive,
  utcDayStartEpochMs,
} from '@/trading/sources/rows/normalization'

export const VIETCOMBANK_DEFAULT_ENDPOINT = 'https://www.vietcombank.com.vn'

const VIETCOMBANK_ID = sourceId('vietcombank')
const RATES_PATH = '/api/exchangerates'
const VND_PAIR_RE = /^([A-Z]{3})VND$/
const SATURDAY = 5

/** The feed answers one day a request, so a window costs a request per weekday. A month of
 *  sessions (the stress confirmer's window) is about 45 calendar days; anything longer is declined
 *  rather than spent: the gold premium's 108-session backfill is `coingecko`'s, one request. */
const MAXIMUM_WINDOW_DAYS = 63

const RATES_RESPONSE = z.object({ Data: z.array(z.unknown()) })

// Every column a string, `"25610.00"`. A currency the bank does not buy by transfer carries a blank
// or a dash there, which reads as no rate rather than a zero one.
const RATE_ROW = z.object({
  currencyCode: z.string().min(1),
  transfer: z.string(),
  sell: z.string(),
})

interface FxWindow {
  readonly currency: string
  readonly days: readonly TradingDay[]
}

export function createVietcombankSources(
  options: SourceAdapterOptions
): readonly RegisteredSource[] {
  return [fxHistorySource(options)]
}

/** Behind `yahoo`: the bank sets its board once or twice a day, so a day's rate is not the market's
 *  close. The level is the midpoint of the transfer buy and sell rates — over 60 sessions it sat 4
 *  VND from Yahoo's on average, where the transfer buy rate alone sat 194 VND (0.75%) below it. */
function fxHistorySource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VIETCOMBANK_ID,
    kind: 'fxHistory',
    http: options.http,
    covers: (context) => fxWindow(context) !== null,
    load: (context, signal) => loadRates(options.http, context, signal),
  })
}

async function loadRates(
  http: SourceHttp,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<readonly FxRatePoint[]>>> {
  const window = fxWindow(context)

  if (window === null) {
    return { kind: 'error', code: 'source.symbol-not-found' }
  }

  const outcomes = await Promise.all(
    window.days.map(async (day) => ({
      day,
      outcome: await http.getJson(
        { sourceId: VIETCOMBANK_ID, path: RATES_PATH, query: { date: day }, signal },
        (raw) => toRate(raw, window.currency)
      ),
    }))
  )
  const points: FxRatePoint[] = []
  let fetchedAt = 0

  // Every day or none: a failed day would leave a hole the store reads as a day the bank did not
  // publish. A day with no board is no point, not a failure.
  for (const { day, outcome } of outcomes) {
    if (outcome.kind === 'error') {
      return outcome
    }

    fetchedAt = Math.max(fetchedAt, outcome.fetchedAt)

    if (outcome.value !== undefined) {
      points.push({ day, rate: outcome.value })
    }
  }

  return { kind: 'ok', value: parsedSource(points), fetchedAt }
}

/** Weekdays only: the board repeats Friday's rates on a weekend, which is no new reading. */
function fxWindow(context: SourceContext): FxWindow | null {
  const { ticker, fromDay, toDay } = context
  const currency = ticker === undefined ? undefined : VND_PAIR_RE.exec(ticker)?.[1]

  if (currency === undefined || fromDay === undefined || toDay === undefined) {
    return null
  }

  if (
    (utcDayStartEpochMs(toDay) - utcDayStartEpochMs(fromDay)) / MS_PER_DAY >
    MAXIMUM_WINDOW_DAYS
  ) {
    return null
  }

  const days = weekdaysBetween(fromDay, toDay)

  return days.length === 0 ? null : { currency, days }
}

function weekdaysBetween(fromDay: TradingDay, toDay: TradingDay): readonly TradingDay[] {
  const days: TradingDay[] = []

  for (let day = fromDay; day <= toDay; day = shiftCalendarDay(day, 1)) {
    if (daysSinceMonday(day) < SATURDAY) {
      days.push(day)
    }
  }

  return days
}

/** A currency the bank has no usable rate for on that day is no point, never a failed day. */
function toRate(raw: unknown, currency: string): number | undefined {
  const rows = dropInvalid(RATES_RESPONSE.parse(raw).Data, toBoardRate)

  return rows.find((row) => row.currency === currency)?.rate
}

function toBoardRate(raw: unknown): { readonly currency: string; readonly rate: number } {
  const row = parseRow(RATE_ROW, raw, 'vietcombank rate')

  return {
    currency: row.currencyCode,
    rate: (positive(Number(row.transfer), 'transfer') + positive(Number(row.sell), 'sell')) / 2,
  }
}
