import { z } from 'zod'

import type { TradingDay } from '@/trading/kernel/instrument'
import type { MarketEvent } from '@/trading/kernel/market/market-event'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import { isLevelKind } from '@/trading/kernel/instrument'
import {
  getNasdaqData,
  NASDAQ_ID,
  parseUsDay,
  parseUsd,
} from '@/trading/sources/adapters/nasdaq/client'
import { createSource, parsedSource } from '@/trading/sources/define'
import { dropInvalid, parseRow, untrustedText } from '@/trading/sources/rows/normalization'

const DIVIDENDS = z.object({
  dividends: z.object({ rows: z.array(z.unknown()).nullable() }),
})

/** Nasdaq types a cash payment "Cash"; a stock dividend or a spin-off carries no dollar amount. */
const CASH_TYPE_RE = /^cash$/i

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
  const paysOn = paymentDay(row.paymentDate)
  const cash = cashOf(row)

  // The amount sizes the ex-date gap a level is moved by, so a cash row that states none (or not as a
  // positive dollar figure) carries no figure rather than a zero gap.
  return parsedSource(
    {
      at,
      kind: 'dividend-ex-date',
      title: title.value,
      writtenIn: 'en',
      // A row with no cash figure (a stock or special dividend stated as a ratio) keeps its own
      // words, which say what kind it is; a cash row is worded from the kind and the amount.
      ...(cash.cashPerShare === undefined ? {} : { composedText: true as const }),
      ...(context.instrument === undefined ? {} : { instrument: context.instrument }),
      ...cash,
      ...(paysOn === undefined ? {} : { paysOn, detail: `Paid ${paysOn}` }),
    },
    title.caveats
  )
}

function cashOf(row: z.infer<typeof DIVIDEND_ROW>): { cashPerShare?: number } {
  if (!CASH_TYPE_RE.test(row.type)) {
    return {}
  }

  try {
    const amount = parseUsd(row.amount)

    return amount > 0 ? { cashPerShare: amount } : {}
  } catch {
    // "N/A" or a ratio: the cash amount is simply not stated.
    return {}
  }
}

function paymentDay(raw: string | undefined): TradingDay | undefined {
  if (raw === undefined) {
    return undefined
  }

  try {
    return parseUsDay(raw)
  } catch {
    // "N/A" on an older row: the payment day is simply not stated.
    return undefined
  }
}
