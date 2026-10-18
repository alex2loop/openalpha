import { z } from 'zod'

import { roundToStep } from '@/trading/kernel/instrument'
import { DECIMAL } from '@/trading/venues/binance/transport'

const LOT_SIZE_FILTER = 'LOT_SIZE'
const PRICE_FILTER = 'PRICE_FILTER'
// `NOTIONAL` replaced `MIN_NOTIONAL`; a symbol carries one or the other.
const NOTIONAL_FILTERS: ReadonlySet<string> = new Set(['NOTIONAL', 'MIN_NOTIONAL'])
const FILTER = z.object({
  filterType: z.string(),
  minQty: DECIMAL.optional(),
  stepSize: DECIMAL.optional(),
  tickSize: DECIMAL.optional(),
  minNotional: DECIMAL.optional(),
  // The two filters name the same switch differently: NOTIONAL `applyMinToMarket`, MIN_NOTIONAL
  // `applyToMarket`.
  applyMinToMarket: z.boolean().optional(),
  applyToMarket: z.boolean().optional(),
})
const SYMBOL_INFO = z.object({
  symbol: z.string(),
  baseAsset: z.string(),
  quoteAsset: z.string(),
  isSpotTradingAllowed: z.boolean(),
  filters: z.array(FILTER),
})

export const EXCHANGE_INFO_PATH = '/api/v3/exchangeInfo'
export const EXCHANGE_INFO = z.object({ symbols: z.array(SYMBOL_INFO) })
/** The whole listing, rows left unread so one odd row costs itself rather than the listing. */
export const EXCHANGE_INFO_ROWS = z.object({ symbols: z.array(z.unknown()) })

type SymbolInfo = z.infer<typeof SYMBOL_INFO>

interface SymbolFilters {
  readonly lotSize: number
  readonly minimumQuantity: number
  readonly tickSize: number
  readonly minimumNotional: number
  readonly minimumNotionalAppliesToMarket: boolean
}

export function parseSymbolInfo(raw: unknown): SymbolInfo | undefined {
  const parsed = SYMBOL_INFO.safeParse(raw)

  return parsed.success ? parsed.data : undefined
}

/** Undefined where the lot or the price grid is missing: a symbol no order can be rounded onto is
 *  not one this venue can be asked to trade. */
export function toSymbolFilters(info: SymbolInfo): SymbolFilters | undefined {
  const lot = info.filters.find((filter) => filter.filterType === LOT_SIZE_FILTER)
  const grid = info.filters.find((filter) => filter.filterType === PRICE_FILTER)
  const notional = info.filters.find((filter) => NOTIONAL_FILTERS.has(filter.filterType))
  const lotSize = lot?.stepSize ?? 0
  const tickSize = grid?.tickSize ?? 0

  if (!(lotSize > 0 && tickSize > 0)) {
    return undefined
  }

  return {
    lotSize,
    minimumQuantity: lot?.minQty ?? 0,
    tickSize,
    minimumNotional: notional?.minNotional ?? 0,
    minimumNotionalAppliesToMarket: notional?.applyMinToMarket ?? notional?.applyToMarket ?? false,
  }
}

/** The smallest order Binance accepts: its quantity floor, or the value floor at `price`, whichever
 *  is larger. Without a price only the quantity floor is known. */
export function minimumSizeOf(filters: SymbolFilters, price: number | undefined): number {
  if (price === undefined || !(price > 0) || !(filters.minimumNotional > 0)) {
    return filters.minimumQuantity
  }

  const byValue = roundToStep(filters.minimumNotional / price, filters.lotSize, 'up')

  return Math.max(filters.minimumQuantity, byValue)
}
