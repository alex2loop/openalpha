import type { TradingHost, TradingHostDeps } from '@/trading/wiring/host/types'
import { ValidationError } from '@/core/errors'
import { parseTickers } from '@/trading/kernel/surface/surface'
import { scoped } from '@/trading/wiring/host/scope'

export type ProfileMethods = Pick<TradingHost, 'updateWatchlist' | 'getSetup'>

/** The profile's watchlist edit and the two facts a first run turns on. */
export function profileMethods(deps: TradingHostDeps): ProfileMethods {
  return {
    // Names arrive as an operator types them (`fpt`, `crypto:hdb`) and resolve as `/watchlist`
    // resolves them: a name nothing matches, or two markets claim, refuses the whole call.
    updateWatchlist: (request) =>
      scoped(deps, request.signal, (scope) => {
        const tickers = parseTickers(request.names, deps.services.marketData.markets())

        if (tickers === null) {
          throw new ValidationError('watchlist names must be 1 to a few valid tickers', {
            key: 'errors.watchlistNamesInvalid',
          })
        }

        return deps.services.profiles.updateWatchlist({
          kind: request.kind,
          tickers,
          signal: scope.signal,
        })
      }),

    getSetup: (signal) =>
      scoped(deps, signal, async (scope) => {
        const [profileSaved, firstRow] = await Promise.all([
          deps.services.profiles.isSaved({ signal: scope.signal }),
          deps.services.portfolio.historyAbsolute({ limit: 1, signal: scope.signal }),
        ])

        return { profileSaved, bookEmpty: firstRow.items.length === 0 }
      }),
  }
}
