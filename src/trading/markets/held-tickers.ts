import type { InstrumentRef, MarketRef, Ticker } from '@/trading/kernel/instrument'
import type { MarketDeps } from '@/trading/markets/deps'

interface ReadOptions {
  readonly now: number
  readonly signal: AbortSignal
}

/** What the operator holds and what it watches in one market, from one read of each. */
interface FollowedTickers {
  readonly held: ReadonlySet<Ticker>
  /** Held and watched together: what a refresh keeps evidence for whether or not it ranks. */
  readonly followed: ReadonlySet<Ticker>
}

/** The names the operator holds in one market. A market composing no brief has no view of the book,
 *  and reads its board alone. */
export async function heldTickersIn(
  deps: Pick<MarketDeps, 'briefServices'>,
  market: MarketRef,
  options: ReadOptions
): Promise<ReadonlySet<Ticker>> {
  return tickersIn((await deps.briefServices?.holdings(options)) ?? [], market)
}

export async function followedTickersIn(
  deps: Pick<MarketDeps, 'briefServices'>,
  market: MarketRef,
  options: ReadOptions
): Promise<FollowedTickers> {
  const services = deps.briefServices

  if (services === undefined) {
    return { held: new Set(), followed: new Set() }
  }

  const [holdings, profile] = await Promise.all([
    services.holdings(options),
    services.profile(options),
  ])
  const held = tickersIn(holdings, market)

  return { held, followed: new Set([...held, ...tickersIn(profile.watchlist, market)]) }
}

function tickersIn(instruments: readonly InstrumentRef[], market: MarketRef): ReadonlySet<Ticker> {
  return new Set(
    instruments
      .filter((instrument) => instrument.market === market)
      .map((instrument) => instrument.ticker)
  )
}
