import type { MarketRef, Ticker } from '@/trading/kernel/instrument'
import type { MarketDeps } from '@/trading/markets/deps'

/** The names the operator holds in one market. A market composing no brief has no view of the book,
 *  and reads its board alone. */
export async function heldTickersIn(
  deps: Pick<MarketDeps, 'briefServices'>,
  market: MarketRef,
  options: { readonly now: number; readonly signal: AbortSignal }
): Promise<ReadonlySet<Ticker>> {
  const holdings = (await deps.briefServices?.holdings(options)) ?? []

  return new Set(
    holdings
      .filter((instrument) => instrument.market === market)
      .map((instrument) => instrument.ticker)
  )
}
