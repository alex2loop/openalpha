import type { PortfolioAtOptions } from '@/trading/features/portfolio/options'
import type { Holding, PortfolioService } from '@/trading/features/portfolio/types'
import type { VenueRegistry } from '@/trading/venues/types'
import { toTradeableHoldings } from '@/trading/features/portfolio/folds/holdings'
import { minimumSizesByInstrument } from '@/trading/venues/holdings'

/** The book read the delivery services need assembled rather than injected: it joins the portfolio
 *  service to the venue catalogs, which no service on either side reaches. */
interface DeliveryReadDeps {
  readonly portfolio: PortfolioService
  readonly venues: VenueRegistry
}

/** What the exit watch and both reconcile passes read. Assembled here because each reaches it
 *  through its own seam, and the venue floors it filters against are a composition concern. */
export async function tradeableHoldingsAt(
  deps: DeliveryReadDeps,
  options: PortfolioAtOptions
): Promise<readonly Holding[]> {
  const positions = await deps.portfolio.positionsAt(options)
  const minimumSizes = await minimumSizesByInstrument(deps.venues, positions, options.signal)

  return toTradeableHoldings(positions, minimumSizes)
}
