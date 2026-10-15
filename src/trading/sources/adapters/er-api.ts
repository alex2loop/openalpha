// Source class: free and keyless community FX API (open.er-api.com). Daily reference rates — it
// stands behind yahoo in the fx failover order, never first.
import { z } from 'zod'

import type { FxQuote } from '@/trading/kernel/market/market-data'
import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { ValidationError } from '@/core/errors'
import { MS_PER_SECOND } from '@/core/utils/time'
import { currencyCode } from '@/trading/kernel/instrument'
import { sourceId } from '@/trading/kernel/source/source-id'
import { createSource, parsedSource } from '@/trading/sources/define'
import { dayFromEpochSeconds, fromCodeTable, positive } from '@/trading/sources/rows/normalization'

const ER_API_ID = sourceId('er-api')
export const ER_API_DEFAULT_ENDPOINT = 'https://open.er-api.com'

const CURRENCY_PAIR_RE = /^([A-Z]{3})([A-Z]{3})$/

const RESPONSE = z.object({
  result: z.literal('success'),
  time_last_update_utc: z.string(),
  rates: z.record(z.string(), z.number()),
})

export function createErApiSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [
    createSource({
      id: ER_API_ID,
      kind: 'fx',
      format: 'json',
      http: options.http,
      covers: (context) => context.ticker !== undefined && CURRENCY_PAIR_RE.test(context.ticker),
      request: (context) => {
        const match = context.ticker ? CURRENCY_PAIR_RE.exec(context.ticker) : null

        return match ? { path: `/v6/latest/${match[1]}` } : null
      },
      parse: (raw, context, fetchedAt) => parsedSource(toFxQuote(raw, context.ticker, fetchedAt)),
    }),
  ]
}

function toFxQuote(raw: unknown, pair: string | undefined, fetchedAt: number): FxQuote {
  const match = pair ? CURRENCY_PAIR_RE.exec(pair) : null

  if (!match) {
    throw new ValidationError('er-api fx requires a currency-pair ticker')
  }

  const response = RESPONSE.parse(raw)
  const rate = positive(fromCodeTable(response.rates, match[2] ?? ''), 'rate')

  return {
    fromCurrency: currencyCode(match[1] ?? ''),
    toCurrency: currencyCode(match[2] ?? ''),
    rate,
    asOf: dayFromEpochSeconds(Date.parse(response.time_last_update_utc) / MS_PER_SECOND, 'UTC'),
    sourceId: ER_API_ID,
    fetchedAt,
  }
}
