import { z } from 'zod'

import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { Quote } from '@/trading/kernel/market/market-data'
import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import {
  assetClassOf,
  getNasdaqData,
  NASDAQ_ID,
  parseEasternInstant,
  parsePercent,
  parseUsd,
} from '@/trading/sources/adapters/nasdaq/client'
import { createSource, parsedSource } from '@/trading/sources/define'
import { parseRow, positive } from '@/trading/sources/rows/normalization'
import { QUOTE_ATTEMPT_LIMITS } from '@/trading/sources/transport/http'

const INFO = z.object({
  primaryData: z.object({
    lastSalePrice: z.string(),
    percentageChange: z.string().optional(),
    lastTradeTimestamp: z.string(),
  }),
})

export function nasdaqQuoteSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: NASDAQ_ID,
    kind: 'quote',
    http: options.http,
    covers: (context) => context.instrument !== undefined,
    load: async (context, signal) => {
      const { instrument } = context

      if (instrument === undefined) {
        return { kind: 'error', code: 'source.symbol-not-found' }
      }

      return getNasdaqData(
        options.http,
        {
          ...QUOTE_ATTEMPT_LIMITS,
          path: `/api/quote/${instrument.ticker}/info`,
          query: { assetclass: assetClassOf(context.instrumentKind) },
          signal,
        },
        (data) => parsedSource(toQuote(data, instrument))
      )
    },
    observedAt: (value) => value.observedAt,
  })
}

/** An empty price (a halted name, a closed index) rejects the payload, so the quote capability falls
 *  back to the stored close instead of printing a zero. */
function toQuote(data: unknown, instrument: InstrumentRef): Quote {
  const { primaryData } = parseRow(INFO, data, 'nasdaq quote')
  const changePct =
    primaryData.percentageChange === undefined
      ? undefined
      : parsePercent(primaryData.percentageChange)

  return {
    instrument,
    price: positive(parseUsd(primaryData.lastSalePrice), 'lastSalePrice'),
    ...(changePct === undefined ? {} : { changePct }),
    observedAt: parseEasternInstant(primaryData.lastTradeTimestamp),
  }
}
