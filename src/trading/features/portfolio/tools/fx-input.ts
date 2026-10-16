import { z } from 'zod'

import { isCurrencyCode } from '@/trading/kernel/instrument'

export const operatorFxRate = z
  .number()
  .positive()
  .optional()
  .describe(
    'Units of book currency per unit of `currency`, only when the operator stated the rate they were charged. Omit otherwise.'
  )
export const fxRateConfirmed = z
  .literal(true)
  .optional()
  .describe(
    "True only when the operator accepted the day's market rate for a row in another currency. Omit otherwise."
  )
export const cashCurrency = z
  .string()
  .refine(isCurrencyCode, 'must be a currency code')
  .optional()
  .describe("Currency of the amount; omit for the book's base currency. USDT at a crypto venue.")
