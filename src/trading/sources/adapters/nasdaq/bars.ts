import { z } from 'zod'

import type { TradingDay } from '@/trading/kernel/instrument'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import { MS_PER_SECOND } from '@/core/utils/time'
import { isLevelKind } from '@/trading/kernel/instrument'
import {
  assetClassOf,
  getNasdaqData,
  NASDAQ_ID,
  NASDAQ_TIMEZONE,
  parseCount,
  parseUsDay,
  parseUsd,
} from '@/trading/sources/adapters/nasdaq/client'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  dayFromEpochSeconds,
  dropInvalid,
  parseRow,
  toCandle,
} from '@/trading/sources/rows/normalization'

const BAR_LIMIT = '9999'
/** A bad symbol is the only 400 this endpoint answers over a past range. */
const BUSINESS_MISS_STATUSES = Object.freeze([400])

const HISTORY = z.object({
  tradesTable: z.object({ rows: z.array(z.unknown()).nullable() }),
})

const BAR_ROW = z.object({
  date: z.string(),
  open: z.string(),
  high: z.string(),
  low: z.string(),
  close: z.string(),
  volume: z.string(),
})

export function nasdaqBarsSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: NASDAQ_ID,
    kind: 'bars',
    http: options.http,
    covers: (context) => context.instrument !== undefined,
    load: async (context, signal) => {
      const { instrument, fromDay, toDay } = context

      if (instrument === undefined || fromDay === undefined || toDay === undefined) {
        return { kind: 'error', code: 'source.symbol-not-found' }
      }

      return getNasdaqData(
        options.http,
        {
          businessMissStatuses: BUSINESS_MISS_STATUSES,
          path: `/api/quote/${instrument.ticker}/historical`,
          // Asked through today and sliced: a range that ends in the past answers no rows at all.
          query: {
            assetclass: assetClassOf(context.instrumentKind),
            fromdate: fromDay,
            todate: dayFromEpochSeconds(Date.now() / MS_PER_SECOND, NASDAQ_TIMEZONE),
            limit: BAR_LIMIT,
          },
          signal,
        },
        (data) => toBars(data, context, toDay)
      )
    },
  })
}

function toBars(
  data: unknown,
  context: SourceContext,
  toDay: TradingDay
): ParsedSource<readonly Candle[]> {
  const { rows } = parseRow(HISTORY, data, 'nasdaq history').tradesTable
  const level = isLevelKind(context.instrumentKind)
  const candles = dropInvalid(rows ?? [], (row) => toBarCandle(row, level)).filter(
    (candle) => candle.at <= toDay
  )

  return parsedSource(candles.sort((left, right) => left.at.localeCompare(right.at)))
}

/** The feed prices every bar on the split-adjusted basis, and an index publishes no volume. */
function toBarCandle(raw: unknown, level: boolean): Candle {
  const row = parseRow(BAR_ROW, raw, 'nasdaq bar')

  return toCandle({
    at: parseUsDay(row.date),
    open: parseUsd(row.open),
    high: parseUsd(row.high),
    low: parseUsd(row.low),
    close: parseUsd(row.close),
    volume: level ? 0 : parseCount(row.volume),
    adjustment: 'adjusted',
  })
}
