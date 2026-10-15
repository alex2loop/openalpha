// Source class: community aggregator, free and keyless (giavang.now, documented at /en/api). The
// one domestic board that quotes native VND per lượng, so no unit conversion, and the only one
// with a dated history of the bar.
import { z } from 'zod'

import type { TradingDay, VnGoldForm } from '@/trading/kernel/instrument'
import type { GoldBoard, GoldBoardPoint, GoldBoardRow } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import { ValidationError } from '@/core/errors'
import { dayInZone, MS_PER_DAY, MS_PER_SECOND } from '@/core/utils/time'
import { tradingDay } from '@/trading/kernel/instrument'
import { sourceId } from '@/trading/kernel/source/source-id'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  assembleGoldBoard,
  toGoldBoardPoint,
  toGoldBoardRow,
  VN_BOARD_TIMEZONE,
} from '@/trading/sources/rows/gold-board'
import {
  dropInvalid,
  fromCodeTable,
  utcDayStartEpochMs,
} from '@/trading/sources/rows/normalization'

const GIAVANG_ID = sourceId('giavang')
export const GIAVANG_DEFAULT_ENDPOINT = 'https://giavang.now'
// Same backend on a second host: transport failover keeps the fallback alive when one host is down.
export const GIAVANG_FALLBACK_ENDPOINT = 'https://vang.today'
const PRICES_PATH = '/api/prices'
/** The bar and only the bar: `selectForm` would pick a ring on some days, and a window whose form
 *  changes partway through is not one population. */
const HISTORY_TYPE = 'SJL1L10'

// Exact type codes, and only the two the feed prices honestly: its PNJ rows shadow the SJC bar
// price (they never diverge from it), so pnj-ring stays with pnj rather than taking a ring price
// from a mislabeled feed. Everything else the feed carries is ignored by omission.
const TYPE_FORMS: Readonly<Record<string, VnGoldForm>> = Object.freeze({
  SJL1L10: 'sjc-bar',
  DOJINHTV: 'doji-ring',
})
const VND = 'VND'
/** How far ahead of the fetch's own wall clock a board's stamped timestamp may sit before it stops
 *  reading as clock drift and starts reading as a unit error. The feed documents `timestamp` as
 *  epoch seconds; a millisecond emission multiplied by `MS_PER_SECOND` lands centuries in the
 *  future, which would otherwise disable `isBoardStale` for good. */
const MAXIMUM_TIMESTAMP_SKEW_MS = MS_PER_DAY
/** The feed honours `days` past its documented ceiling and answers with whatever coverage it holds,
 *  so a window far longer than a rolling year is the shape changing rather than a longer history. */
const MAXIMUM_HISTORY_POINTS = 512

const RESPONSE = z.object({
  success: z.literal(true),
  timestamp: z.number(),
  date: z.string(),
  prices: z.record(
    z.string(),
    z.object({ buy: z.number(), sell: z.number(), currency: z.string() })
  ),
})

type PriceEntry = z.infer<typeof RESPONSE>['prices'][string]

const HISTORY_RESPONSE = z.object({
  success: z.literal(true),
  history: z.array(
    z.object({
      date: z.string(),
      prices: z.record(z.string(), z.object({ buy: z.number(), sell: z.number() })),
    })
  ),
})

type HistoryPrice = z.infer<typeof HISTORY_RESPONSE>['history'][number]['prices'][string]

interface HistorySpan {
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
}

export function createGiavangSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [
    createSource({
      id: GIAVANG_ID,
      kind: 'goldBoard',
      format: 'json',
      http: options.http,
      covers: () => true,
      request: () => ({ path: PRICES_PATH }),
      parse: (raw, _context, fetchedAt) => parseBoard(raw, fetchedAt),
      observedAt: (value) => value.observedAt,
    }),
    createSource({
      id: GIAVANG_ID,
      kind: 'goldBoardHistory',
      format: 'json',
      http: options.http,
      covers: (context) => historySpan(context) !== null,
      request: (context) => {
        const span = historySpan(context)

        return span === null
          ? null
          : {
              path: PRICES_PATH,
              query: { type: HISTORY_TYPE, days: String(daysBack(span.fromDay, Date.now())) },
            }
      },
      parse: (raw, context) => parseHistory(raw, context.toDay),
    }),
  ]
}

function parseBoard(raw: unknown, fetchedAt: number): ParsedSource<GoldBoard> {
  const response = RESPONSE.parse(raw)
  const observedAt = response.timestamp * MS_PER_SECOND

  if (observedAt > fetchedAt + MAXIMUM_TIMESTAMP_SKEW_MS) {
    throw new ValidationError('giavang timestamp is not a plausible epoch-seconds value')
  }

  return parsedSource(
    assembleGoldBoard(
      {
        sourceId: GIAVANG_ID,
        fetchedAt,
        observedAt,
        asOf: tradingDay(response.date),
      },
      dropInvalid(Object.entries(response.prices), ([code, price]) => toRow(code, price))
    )
  )
}

function toRow(code: string, price: PriceEntry): GoldBoardRow {
  const form = fromCodeTable(TYPE_FORMS, code)

  if (form === undefined || price.currency !== VND) {
    throw new ValidationError('not a quoted gold form')
  }

  return toGoldBoardRow({ form, vendor: GIAVANG_ID, buy: price.buy, sell: price.sell })
}

/** The feed counts back from today in whole days, so the window has to arrive as a span the caller
 *  owns rather than a figure this adapter picks. */
function historySpan(context: SourceContext): HistorySpan | null {
  const { fromDay, toDay } = context

  if (fromDay === undefined || toDay === undefined || fromDay > toDay) {
    return null
  }

  return { fromDay, toDay }
}

/** The feed's count includes today, so reaching `fromDay` takes every day from it to today, however
 *  far `toDay` sits behind. `now` is the request's own clock. */
function daysBack(fromDay: TradingDay, now: number): number {
  const today = tradingDay(dayInZone(now, VN_BOARD_TIMEZONE))
  const elapsed = utcDayStartEpochMs(today) - utcDayStartEpochMs(fromDay)

  return Math.max(1, Math.round(elapsed / MS_PER_DAY) + 1)
}

/** The feed answers newest first, so the bound is taken from the end: an over-long answer runs long
 *  at the old end, and the newest days are the ones the window is short of. Days past `toDay` (a
 *  board still forming today) are not part of the window. */
function parseHistory(
  raw: unknown,
  toDay: TradingDay | undefined
): ParsedSource<readonly GoldBoardPoint[]> {
  const response = HISTORY_RESPONSE.parse(raw)
  const rows = response.history
    .filter((entry) => toDay === undefined || entry.date <= toDay)
    .flatMap((entry) =>
      Object.entries(entry.prices).map(([code, price]) => ({ date: entry.date, code, price }))
    )
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-MAXIMUM_HISTORY_POINTS)
  const points = dropInvalid(rows, (row) => toPoint(row.date, row.code, row.price))

  if (points.length === 0) {
    throw new ValidationError('giavang history carried no dated board')
  }

  return parsedSource(points)
}

function toPoint(date: string, code: string, price: HistoryPrice): GoldBoardPoint {
  const form = fromCodeTable(TYPE_FORMS, code)

  if (form === undefined) {
    throw new ValidationError('not a quoted gold form')
  }

  return toGoldBoardPoint({
    day: tradingDay(date),
    form,
    vendor: GIAVANG_ID,
    buy: price.buy,
    sell: price.sell,
  })
}
