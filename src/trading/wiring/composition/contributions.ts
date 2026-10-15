import type { Logger } from '@/core/logging/logger'
import type { LedgerStore } from '@/trading/features/ledger/store/ledger'
import type { IntradaySettingsStore } from '@/trading/features/market-data/store/intraday-settings'
import type { TradingConfig } from '@/trading/kernel/config'
import type { MarketRegistry } from '@/trading/markets/types'
import type { VenueRegistry } from '@/trading/venues/types'
import type { TradingContributions } from '@/trading/wiring/composition/registry-checks'
import type { TradingServices } from '@/trading/wiring/composition/service-aggregate'
import type { createDomainServices } from '@/trading/wiring/composition/services'
import type { WithThemes } from '@/trading/wiring/composition/themes'
import { ConfigError } from '@/core/errors'
import { createTradingCommands } from '@/trading/wiring/catalog/commands'
import { createTradingTools } from '@/trading/wiring/catalog/tools'

interface ContributionsInput {
  readonly services: ReturnType<typeof createDomainServices> & WithThemes
  readonly config: TradingConfig
  readonly refreshMarketData: TradingServices['refreshMarketData']
  readonly markets: MarketRegistry
  readonly venues: VenueRegistry
  readonly intradaySettings: IntradaySettingsStore
  readonly ledger: LedgerStore
  readonly logger: Logger
}

/** The built surface definitions, in one place so the locale gate and every `extend` read the same
 *  object. Terminal commands stay empty until the first contributed one ships. */
export function buildContributions(input: ContributionsInput): TradingContributions {
  return {
    tools: createTradingTools({
      ...input.services,
      costs: input.config.costs,
      defaultVenues: input.config.defaultVenues,
      baseCurrency: input.config.baseCurrency,
      displayTimezone: input.config.displayTimezone,
    }),
    commands: createTradingCommands({
      portfolio: input.services.portfolio,
      nav: input.services.nav,
      profiles: input.services.profiles,
      marketData: input.services.marketData,
      alerts: input.services.alerts,
      briefs: input.services.briefs,
      themes: input.services.themes,
      suggestions: input.services.suggestions,
      factorLog: input.services.factorLog,
      refreshMarketData: input.refreshMarketData,
      markets: input.markets,
      venues: input.venues,
      config: input.config,
      intradaySettings: input.intradaySettings,
      ledger: input.ledger,
      logger: input.logger,
      defaultRegion: input.config.defaultRegion,
      ...(input.services.order === undefined ? {} : { order: input.services.order }),
    }),
    cliCommands: [],
  }
}

interface MergeUniqueByKeyOptions<T> {
  readonly current: ReadonlyMap<string, T>
  readonly additions: Iterable<T>
  readonly keyOf: (item: T) => string
  readonly label: string
}

export function mergeUniqueByKey<T>(options: MergeUniqueByKeyOptions<T>): ReadonlyMap<string, T> {
  const { current, additions, keyOf, label } = options
  const merged = new Map(current)

  for (const item of additions) {
    const key = keyOf(item)

    if (merged.has(key)) {
      throw new ConfigError(`duplicate ${label}: ${key}`)
    }
    merged.set(key, item)
  }

  return merged
}
