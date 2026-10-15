import type { BriefServices } from '@/trading/features/brief/types'
import type { MarketDataStore } from '@/trading/features/market-data/store/market-data'
import type { TradingConfig } from '@/trading/kernel/config'
import type { FxRates } from '@/trading/kernel/market/fx-rates'
import type { VenueListings } from '@/trading/kernel/venue/catalog'
import type { MacroCache } from '@/trading/markets/macro-cache'
import type { StageRegistry } from '@/trading/markets/stage'
import type { SourceRegistry } from '@/trading/markets/types'

/** Everything a market factory is handed. `config` is the whole frozen `TradingConfig` for
 *  composition simplicity, but a market reads only its own `[trading.markets.<id>]` table and the
 *  brief policy it renders under; every other strategy parameter lives in its folder's `policy.ts`.
 *  Live evidence comes from `sources`; `marketDataStore` is the cache a market reads
 *  population-wide views out of — a universe screen cannot issue one live request per name — and
 *  the one store a universe refresh replaces its scope in. Markets receive no logger and no clock:
 *  every instant arrives in a request. */
export interface MarketDeps {
  readonly config: TradingConfig
  readonly sources: SourceRegistry
  /** Every currency conversion, including the ones a market reads for its own evidence: the shared
   *  path remembers each rate and falls back to the last one when no provider answers. */
  readonly fx: FxRates
  readonly marketDataStore: MarketDataStore
  /** The shared macro read: every market asking the same region and day gets one fan-out. */
  readonly macro: MacroCache
  /** Where a market contributes its own pipeline stages, registered as the market is built so a
   *  stage shares whatever the market already caches. */
  readonly stages: StageRegistry
  /** What the venues holding a market actually list, so a board never ranks a name that cannot be
   *  bought anywhere. Required: a market that does not gate on it simply never asks. */
  readonly venueListings: VenueListings
  /** Present only for a market that composes a user-facing brief. Absent means the market simply
   *  does not publish a `brief` capability — never a brief method that throws. `app` binds a thin
   *  adapter whose methods resolve the owning service at call time, so the market registry does
   *  not have to exist before the services that depend on it. */
  readonly briefServices?: BriefServices
}
