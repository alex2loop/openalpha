import type { MarketDataService } from '@/trading/features/market-data/types'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import { OrderError } from '@/trading/features/order/types'

/** The live price the caps, the drift check and the prompt all read. An unpriced instrument is a
 *  refusal, not a zero: every cap downstream would pass against one. */
export async function quoteOf(
  marketData: MarketDataService,
  instrument: InstrumentRef,
  at: { readonly now: number; readonly signal: AbortSignal }
): Promise<number> {
  const result = await marketData.quote({
    ticker: instrument.ticker,
    market: instrument.market,
    now: at.now,
    signal: at.signal,
  })

  // A close or a stale print also reads as available; sizing and drift run on the live tape only.
  if (result.kind !== 'available' || result.value.observed.kind !== 'live') {
    throw new OrderError('order.quote_not_live', `no live price for ${instrument.ticker}`)
  }

  return result.value.quote.price
}
