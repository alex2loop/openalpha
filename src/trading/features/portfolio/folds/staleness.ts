import type { Holding } from '@/trading/features/portfolio/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { FxQuote, QuoteFreshness } from '@/trading/kernel/market/market-data'

// A valuation's inputs are old against the last session the region closed, never against the
// calendar day: the two differ every weekend and holiday, and judging a close by the calendar day
// reports the newest price on the book as stale for as long as the market stays shut.

/** Only a 'close' mark from a session before the last one to settle is stale; a 'live' mark never
 *  is. */
export function staleQuoteCaveats(
  position: Holding,
  observed: QuoteFreshness,
  settledDay: TradingDay
): readonly Caveat[] {
  if (observed.kind === 'live' || observed.day >= settledDay) {
    return []
  }

  return [
    {
      code: 'valuation.price-stale',
      detail: { ticker: position.instrument.ticker, markedOn: observed.day },
    },
  ]
}

/** A rate dated before the last settled session converts at yesterday's price of money. */
export function staleRateCaveats(rate: FxQuote, settledDay: TradingDay): readonly Caveat[] {
  return rate.asOf < settledDay
    ? [{ code: 'valuation.fx-stale', detail: { currency: rate.fromCurrency, markedOn: rate.asOf } }]
    : []
}
