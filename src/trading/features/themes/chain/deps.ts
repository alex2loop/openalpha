import type { Logger } from '@/core/logging/logger'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { QuarterlyAccounts } from '@/trading/kernel/market/annual-accounts'
import type { InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { SourceRegistry } from '@/trading/markets/types'

/** Reads the stores and the calendar this feature may not import, bound by wiring. */
export interface ChainDeps {
  readonly marketData: Pick<MarketDataService, 'screen' | 'accounts' | 'bars' | 'news'>
  readonly sources: Pick<SourceRegistry, 'resolve'>
  /** Active VN equities, with the ICB super-sector each is filed under. */
  listInstruments(signal: AbortSignal): Promise<readonly InstrumentRecord[]>
  /** Every stored quarter per VN name, oldest first. */
  listQuarters(signal: AbortSignal): Promise<ReadonlyMap<Ticker, readonly QuarterlyAccounts[]>>
  /** The VN session before `day`. */
  previousSession(day: TradingDay): TradingDay
  readonly logger: Logger
}

export interface ChainRequest {
  readonly now: number
  readonly signal: AbortSignal
}
