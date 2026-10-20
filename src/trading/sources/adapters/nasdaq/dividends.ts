import { z } from 'zod'

import type { MarketEvent } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import { isLevelKind } from '@/trading/kernel/instrument'
import { getNasdaqData, NASDAQ_ID, parseUsDay } from '@/trading/sources/adapters/nasdaq/client'
import { createSource, parsedSource } from '@/trading/sources/define'
import { dropInvalid, parseRow, untrustedText } from '@/trading/sources/rows/normalization'

const DIVIDENDS = z.object({
  dividends: z.object({ rows: z.array(z.unknown()).nullable() }),
})

const DIVIDEND_ROW = z.object({
  exOrEffDate: z.string(),
  type: z.string().min(1),
  amount: z.string().min(1),
  paymentDate: z.string().optional(),
})

export function nasdaqEventsSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: NASDAQ_ID,
    kind: 'events',
    http: options.http,
    // The dividends endpoint answers the stocks class only.
    covers: (context) =>
      context.instrument !== undefined &&
      !isLevelKind(context.instrumentKind) &&
      context.instrumentKind !== 'etf',
    load: async (context, signal) => {
      const { instrument } = context

      if (instrument === undefined) {
        return { kind: 'error', code: 'source.symbol-not-found' }
      }

      return getNasdaqData(
        options.http,
        {
          path: `/api/quote/${instrument.ticker}/dividends`,
          query: { assetclass: 'stocks' },
          signal,
        },
        (data) => toDividendEvents(data, context)
      )
    },
  })
}

function toDividendEvents(
  data: unknown,
  context: SourceContext
): ParsedSource<readonly MarketEvent[]> {
  const { rows } = parseRow(DIVIDENDS, data, 'nasdaq dividends').dividends
  const parsed = dropInvalid(rows ?? [], (row) => toDividendEvent(row, context))

  return parsedSource(
    parsed.flatMap((entry) => (entry === undefined ? [] : [entry.value])),
    parsed.flatMap((entry) => entry?.caveats ?? [])
  )
}

/** Undefined when the ex-date falls outside the asked window. */
function toDividendEvent(
  raw: unknown,
  context: SourceContext
): ParsedSource<MarketEvent> | undefined {
  const row = parseRow(DIVIDEND_ROW, raw, 'nasdaq dividend')
  const at = parseUsDay(row.exOrEffDate)

  if (
    (context.fromDay !== undefined && at < context.fromDay) ||
    (context.toDay !== undefined && at > context.toDay)
  ) {
    return undefined
  }

  const title = untrustedText(`${row.type} dividend ${row.amount}`, 'dividend')

  return parsedSource(
    {
      at,
      kind: 'dividend-ex-date',
      title: title.value,
      ...(context.instrument === undefined ? {} : { instrument: context.instrument }),
      ...paymentDetail(row.paymentDate),
    },
    title.caveats
  )
}

function paymentDetail(raw: string | undefined): { detail?: string } {
  if (raw === undefined) {
    return {}
  }

  try {
    return { detail: `Paid ${parseUsDay(raw)}` }
  } catch {
    // "N/A" on an older row: the payment day is simply not stated.
    return {}
  }
}
