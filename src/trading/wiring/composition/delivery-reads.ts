import type { PortfolioAtOptions } from '@/trading/features/portfolio/options'
import type { Holding, PortfolioService } from '@/trading/features/portfolio/types'
import type { VenueRegistry } from '@/trading/venues/types'
import { toTradeableHoldings } from '@/trading/features/portfolio/folds/holdings'
import { minimumSizesByInstrument } from '@/trading/venues/holdings'

/** The book read the delivery services need assembled rather than injected: it joins the portfolio
 *  service to the venue catalogs, which no service on either side reaches. */
interface DeliveryReadDeps {
  readonly portfolio: Pick<PortfolioService, 'positionsAt'>
  readonly venues: VenueRegistry
}

interface TradeableBook {
  tradeableHoldingsAt(options: PortfolioAtOptions): Promise<readonly Holding[]>
}

/** What every surface naming a held position reads: the exit watch, both reconcile passes, the
 *  brief and the intraday report. A sliver left by a full exit is no holding on any of them. */
export function createTradeableBook(deps: DeliveryReadDeps): TradeableBook {
  return {
    tradeableHoldingsAt: async (options) => {
      const positions = await deps.portfolio.positionsAt(options)
      const minimumSizes = await minimumSizesByInstrument(deps.venues, positions, options.signal)

      return toTradeableHoldings(positions, minimumSizes)
    },
  }
}
