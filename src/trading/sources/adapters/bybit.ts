// Source class: free, keyless. Spot klines for the names Binance spot does not list; it sits
// behind Binance in the crypto bars order, so a name both list costs nothing extra. Bybit
// answers errors as HTTP 200 with a retCode, so the miss mapping lives in the fold, not in
// `businessMissStatuses`, which only sees transport statuses.
import { z } from 'zod'

import type { Candle } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceFetchOutcome } from '@/trading/sources/types'
import { MS_PER_SECOND } from '@/core/utils/time'
import { sourceId } from '@/trading/kernel/source/source-id'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  dayFromEpochSeconds,
  dropInvalid,
  klineLimit,
  toCandle,
  utcDayEndEpochMs,
  utcDayStartEpochMs,
} from '@/trading/sources/rows/normalization'
import { withSettledBars } from '@/trading/sources/settled-bars'

export const BYBIT_DEFAULT_ENDPOINT = 'https://api.bybit.com'

const BYBIT_ID = sourceId('bybit')
const DAILY_INTERVAL = 'D'
const MAXIMUM_KLINES = 1000
const SYMBOL_MISS_RET_CODE = 10001

// `result` is `{}` on every error retCode, so `list` cannot be required: demanding it rejects the
// payload before the retCode below can name the miss, turning "no such symbol" into "unparseable".
const ENVELOPE = z.object({
  retCode: z.number(),
  result: z.object({
    list: z.array(z.array(z.string())).optional(),
  }),
})

export function createBybitSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [barsSource(options)]
}

function barsSource(options: SourceAdapterOptions): RegisteredSource {
  return withSettledBars(
    createSource({
      id: BYBIT_ID,
      kind: 'bars',
      http: options.http,
      covers: (context) => context.instrument !== undefined,
      load: (context, signal) => loadBars(options, context, signal),
    })
  )
}

async function loadBars(
  options: SourceAdapterOptions,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<readonly Candle[]>>> {
  if (context.instrument === undefined) {
    return { kind: 'error', code: 'source.symbol-not-found' as const }
  }

  const outcome = await options.http.getJson(
    {
      sourceId: BYBIT_ID,
      path: '/v5/market/kline',
      query: {
        category: 'spot',
        symbol: `${context.instrument.ticker}USDT`,
        interval: DAILY_INTERVAL,
        limit: String(klineLimit(context, MAXIMUM_KLINES)),
        ...(context.fromDay ? { start: String(utcDayStartEpochMs(context.fromDay)) } : {}),
        ...(context.toDay ? { end: String(utcDayEndEpochMs(context.toDay)) } : {}),
      },
      signal,
    },
    (raw) => ENVELOPE.parse(raw)
  )

  if (outcome.kind !== 'ok') {
    return outcome
  }

  if (outcome.value.retCode === SYMBOL_MISS_RET_CODE) {
    return { kind: 'error', code: 'source.symbol-not-found' as const }
  }

  if (outcome.value.retCode !== 0) {
    return { kind: 'error', code: 'source.unavailable' as const }
  }

  return {
    kind: 'ok',
    value: parsedSource(toCandles(outcome.value.result.list ?? [])),
    fetchedAt: outcome.fetchedAt,
  }
}

function toCandles(rows: readonly (readonly string[])[]): readonly Candle[] {
  return dropInvalid([...rows].reverse(), (row) =>
    toCandle({
      at: dayFromEpochSeconds(Number(row[0]) / MS_PER_SECOND, 'UTC'),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      adjustment: 'raw',
    })
  )
}
