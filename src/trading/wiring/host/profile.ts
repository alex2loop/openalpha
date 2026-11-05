import type { TradingHost, TradingHostDeps } from '@/trading/wiring/host/types'
import { ValidationError } from '@/core/errors'
import { portfolioSegment } from '@/trading/kernel/instrument'
import { parseTickers } from '@/trading/kernel/surface/surface'
import { scoped } from '@/trading/wiring/host/scope'

export type ProfileMethods = Pick<
  TradingHost,
  'updateWatchlist' | 'updateSegment' | 'getSetup' | 'profileFields'
>

/** The profile's watchlist edit and segment switch, the two facts a first run turns on and the
 *  settings on offer. */
export function profileMethods(deps: TradingHostDeps): ProfileMethods {
  return {
    profileFields: () => deps.services.profileFields,

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

    updateSegment: (request) =>
      scoped(deps, request.signal, (scope) =>
        deps.services.profiles.updateSegment({
          kind: request.kind,
          segment: portfolioSegment(request.segment),
          signal: scope.signal,
        })
      ),

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
