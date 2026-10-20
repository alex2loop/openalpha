import type { Logger } from '@/core/logging/logger'
import type { LedgerEntry } from '@/trading/features/ledger/types'
import type { OrderIntentStore } from '@/trading/features/order/store/order-intent'
import type { OrderSettingsStore } from '@/trading/features/order/store/order-settings'
import type { RestingExitStore } from '@/trading/features/order/store/resting-exit'
import type { PortfolioService } from '@/trading/features/portfolio/types'
import type { OrderPolicy, TradingCosts } from '@/trading/kernel/config'
import type { CurrencyCode, InstrumentRef, TradingDay, VenueRef } from '@/trading/kernel/instrument'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import type { MarketRegistry } from '@/trading/markets/types'
import type { VenueRegistry } from '@/trading/venues/types'

interface ConversionInput {
  readonly amount: number
  readonly currency: CurrencyCode
  readonly asOf: TradingDay
  readonly signal: AbortSignal
}

/** Consumer-side seams, one per thing this feature cannot do itself. The price and the conversion
 *  are functions rather than whole services: the write path needs one number from each, and binding
 *  the services would hand it reads it has no business making. */
export interface OrderServiceDeps {
  readonly venues: VenueRegistry
  readonly intents: OrderIntentStore
  readonly resting: RestingExitStore
  readonly settings: OrderSettingsStore
  readonly portfolio: Pick<
    PortfolioService,
    'record' | 'viewAbsolute' | 'viewAbsoluteSized' | 'positionsAt'
  >
  readonly markets: MarketRegistry
  readonly policy: OrderPolicy
  /** Fee rates, read by a buy's cash cap so it clears what the fill will bill. */
  readonly costs: TradingCosts
  readonly logger: Logger
  /** The live price the caps, the drift check and the prompt all read. */
  quoteOf(instrument: InstrumentRef, now: number, signal: AbortSignal): Promise<number>
  toBaseCurrency(input: ConversionInput): Promise<number>
  /** The row the book already holds for this venue fill, under the key `/record sync` books it by.
   *  A function rather than the ledger store: this path needs that one row and nothing else the
   *  store holds. */
  findRecordedFill(
    venue: VenueRef,
    orderId: string,
    signal: AbortSignal
  ): Promise<LedgerEntry | undefined>
  /** The operator's concentration ceilings, read where the prompt is built. A function rather than
   *  the profile store: this path needs the caps and nothing else the store holds. `null` when
   *  nothing has been saved, which states no ceilings rather than guessing at seeds. */
  findProfile(signal: AbortSignal): Promise<UserProfile | null>
}
