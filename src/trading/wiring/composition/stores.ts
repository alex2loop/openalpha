import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { Dialect, Storage } from '@/core/types/storage'
import type { AlertStore } from '@/trading/features/alerts/store/alert'
import type { BriefStore } from '@/trading/features/brief/store/brief'
import type { BriefDeliveryStore } from '@/trading/features/brief/store/delivery'
import type { LedgerStore } from '@/trading/features/ledger/store/ledger'
import type { FxRateStore } from '@/trading/features/market-data/store/fx-rate'
import type { IntradaySettingsStore } from '@/trading/features/market-data/store/intraday-settings'
import type { MacroExtractStore } from '@/trading/features/market-data/store/macro-extract'
import type { MarketDataStore } from '@/trading/features/market-data/store/market-data'
import type { NewsArchiveStore } from '@/trading/features/market-data/store/news-archive'
import type { OrderIntentStore } from '@/trading/features/order/store/order-intent'
import type { OrderSettingsStore } from '@/trading/features/order/store/order-settings'
import type { RestingExitStore } from '@/trading/features/order/store/resting-exit'
import type { NavSnapshotStore } from '@/trading/features/portfolio/nav/types'
import type { ProfileStore } from '@/trading/features/profile/store'
import type { AgentFocusStore } from '@/trading/features/suggestion/store/agent-focus'
import type { SuggestionStore } from '@/trading/features/suggestion/store/suggestion'
import type { FactorLogStore } from '@/trading/features/suggestion/track-record/factor-log-types'
import type { ThemeStore } from '@/trading/features/themes/store'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { createAlertStore } from '@/trading/features/alerts/store/alert'
import { createBriefStore } from '@/trading/features/brief/store/brief'
import { createBriefDeliveryStore } from '@/trading/features/brief/store/delivery'
import { createLedgerStore } from '@/trading/features/ledger/store/ledger'
import { createFxRateStore } from '@/trading/features/market-data/store/fx-rate'
import { createIntradaySettingsStore } from '@/trading/features/market-data/store/intraday-settings'
import { createMacroExtractStore } from '@/trading/features/market-data/store/macro-extract'
import { createMarketDataStore } from '@/trading/features/market-data/store/market-data'
import { createNewsArchiveStore } from '@/trading/features/market-data/store/news-archive'
import { createOrderIntentStore } from '@/trading/features/order/store/order-intent'
import { createOrderSettingsStore } from '@/trading/features/order/store/order-settings'
import { createRestingExitStore } from '@/trading/features/order/store/resting-exit'
import { createNavSnapshotStore } from '@/trading/features/portfolio/store/nav-snapshot'
import { createProfileStore } from '@/trading/features/profile/store'
import { createAgentFocusStore } from '@/trading/features/suggestion/store/agent-focus'
import { createSuggestionStore } from '@/trading/features/suggestion/store/suggestion'
import { createFactorLogStore } from '@/trading/features/suggestion/track-record/factor-log-store'
import { createThemeStore } from '@/trading/features/themes/store'

/** Only the ledger store takes a policy value, and only the one it enforces: no store receives the
 *  whole `TradingConfig`. */
export interface TradingStores {
  readonly ledger: LedgerStore
  readonly navSnapshot: NavSnapshotStore
  readonly profile: ProfileStore
  readonly suggestion: SuggestionStore
  readonly agentFocuses: AgentFocusStore
  readonly factorLog: FactorLogStore
  readonly alert: AlertStore
  readonly brief: BriefStore
  readonly briefDelivery: BriefDeliveryStore
  readonly marketData: MarketDataStore
  readonly newsArchive: NewsArchiveStore
  readonly macroExtract: MacroExtractStore
  readonly fxRate: FxRateStore
  readonly intradaySettings: IntradaySettingsStore
  readonly orderIntent: OrderIntentStore
  readonly orderSettings: OrderSettingsStore
  readonly restingExit: RestingExitStore
  readonly themes: ThemeStore
}

interface CreateTradingStoresOptions {
  readonly db: Storage
  readonly dialect: Dialect
  readonly logger: Logger
  readonly maximumEntries: number
  readonly locale: Locale
}

export const createTradingStores = (options: CreateTradingStoresOptions): TradingStores => {
  const deps: StoreDeps = { db: options.db, dialect: options.dialect }

  return Object.freeze({
    ledger: createLedgerStore({ ...deps, maximumEntries: options.maximumEntries }),
    navSnapshot: createNavSnapshotStore(deps),
    profile: createProfileStore({ ...deps, locale: options.locale }),
    suggestion: createSuggestionStore({ ...deps, logger: options.logger }),
    agentFocuses: createAgentFocusStore(deps),
    factorLog: createFactorLogStore(deps),
    alert: createAlertStore(deps),
    brief: createBriefStore(deps),
    briefDelivery: createBriefDeliveryStore(deps),
    marketData: createMarketDataStore(deps),
    newsArchive: createNewsArchiveStore(deps),
    macroExtract: createMacroExtractStore(deps),
    fxRate: createFxRateStore(deps),
    intradaySettings: createIntradaySettingsStore(deps),
    orderIntent: createOrderIntentStore(deps),
    orderSettings: createOrderSettingsStore(deps),
    restingExit: createRestingExitStore(deps),
    themes: createThemeStore(deps),
  })
}
