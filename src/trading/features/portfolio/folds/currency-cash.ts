import type { ValuedCurrencyCash } from '@/trading/features/portfolio/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { CurrencyCode, TradingDay } from '@/trading/kernel/instrument'
import type { FxQuote } from '@/trading/kernel/market/market-data'
import type { Book, CurrencyCash } from '@/trading/kernel/operator/book'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import { staleRateCaveats } from '@/trading/features/portfolio/folds/staleness'

export type Rates = ReadonlyMap<CurrencyCode, SourceResult<FxQuote>>

/** What the book's foreign cash is worth, and what that does to NAV. */
interface CurrencyCashValuation {
  readonly valued: readonly ValuedCurrencyCash[]
  /** False while any held currency has no rate: NAV would leave that cash out. */
  readonly priced: boolean
  readonly caveats: readonly Caveat[]
  /** Today's value over cost; cash at cost is already in `cashBase`. */
  readonly gainBase: number
}

/** Currency cash the book still holds: a spent one stays in the list at zero, and asks for no rate. */
export function heldCurrencyCash(book: Book): readonly CurrencyCash[] {
  return book.currencyCash.filter((cash) => cash.amount > 0)
}

export function valueCurrencyCash(
  book: Book,
  rates: Rates,
  settledDay: TradingDay
): CurrencyCashValuation {
  const held = heldCurrencyCash(book)
  const valued = held.map((cash) => {
    const rate = rates.get(cash.currency)

    return rate === undefined || rate.kind === 'unavailable'
      ? { cash }
      : { cash, valueBase: cash.amount * rate.value.rate }
  })

  return {
    valued,
    priced: valued.every((entry) => entry.valueBase !== undefined),
    // One set per currency: two venues holding USDT share one rate.
    caveats: [...new Set(held.map((cash) => cash.currency))].flatMap((currency) =>
      rateCaveats(currency, rates, settledDay)
    ),
    gainBase: valued.reduce((sum, entry) => sum + (entry.valueBase ?? 0) - entry.cash.costBase, 0),
  }
}

/** The rate caveats a position's row carries, so USDT held as cash is flagged when its rate is
 *  missing, degraded or stale even with no coin priced in it. */
function rateCaveats(
  currency: CurrencyCode,
  rates: Rates,
  settledDay: TradingDay
): readonly Caveat[] {
  const rate = rates.get(currency)

  if (rate === undefined || rate.kind === 'unavailable') {
    return [{ code: 'valuation.fx-missing', detail: { currency } }]
  }

  return [...rate.caveats, ...staleRateCaveats(rate.value, settledDay)]
}
