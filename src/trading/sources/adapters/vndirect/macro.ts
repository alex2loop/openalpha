import { z } from 'zod'

import type { MacroSnapshot } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { ValidationError } from '@/core/errors'
import { tradingDay } from '@/trading/kernel/instrument'
import { MACRO_FORMULA_VERSION } from '@/trading/kernel/market/macro-series'
import { VNDIRECT_ID } from '@/trading/sources/adapters/vndirect/client'
import { createSource, parsedSource } from '@/trading/sources/define'
import { dropInvalid, pageRows, parseRow, positive } from '@/trading/sources/rows/normalization'

const INTEREST_ROW = z.object({
  code: z.string().min(1),
  effectiveDate: z.string().min(1),
  interestRate: z.number(),
})

/** The one macro series VNDirect serves that FRED cannot: the cross-bank average 12-month term
 *  deposit rate, VN equities' risk-free comparator. */
const DEPOSIT_RATE_CODE = 'BANK_AVG_CR_12M'

export function macroSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VNDIRECT_ID,
    kind: 'macro',
    format: 'json',
    http: options.http,
    covers: () => true,
    request: () => ({
      path: '/v4/macro_interests',
      query: { q: `code:${DEPOSIT_RATE_CODE}`, size: '1' },
    }),
    parse: (raw, context, fetchedAt) =>
      parsedSource(toMacroSnapshot(pageRows(raw), context, fetchedAt)),
  })
}

function toMacroSnapshot(
  rows: readonly unknown[],
  context: SourceContext,
  fetchedAt: number
): MacroSnapshot {
  const row = dropInvalid(rows, (raw) => parseRow(INTEREST_ROW, raw, 'vndirect macro interest'))[0]

  if (!row || context.region === undefined) {
    throw new ValidationError('vndirect macro_interests returned no usable row')
  }

  return {
    region: context.region,
    asOf: tradingDay(row.effectiveDate),
    formulaVersion: MACRO_FORMULA_VERSION,
    values: { 'deposit-rate-12m': positive(row.interestRate, 'interestRate') },
    observationDates: { 'deposit-rate-12m': tradingDay(row.effectiveDate) },
    sourceId: VNDIRECT_ID,
    fetchedAt,
  }
}
