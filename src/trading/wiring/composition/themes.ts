import type { App } from '@/core/container'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { ThemeService } from '@/trading/features/themes/types'
import type { ThemePolicy } from '@/trading/kernel/config'
import type { MarketRegistry, SourceRegistry } from '@/trading/markets/types'
import { ConfigError } from '@/core/errors'
import { createBudget, createConfiguredRunBudget } from '@/engine/api'
import { createThemeService } from '@/trading/features/themes/themes'
import { THEME_MARKET } from '@/trading/features/themes/types'

interface ThemeServiceParts {
  readonly sources: SourceRegistry
  readonly markets: MarketRegistry
  readonly marketData: MarketDataService
  readonly policy: ThemePolicy
}

export interface WithThemes {
  readonly themes: ThemeService
}

export function buildThemeService(app: App, parts: ThemeServiceParts): ThemeService {
  const stores = app.resolve('tradingStores')
  const logger = app.resolve('logger')

  const calendar = parts.markets.find(THEME_MARKET)?.manifest.calendar

  if (calendar === undefined) {
    throw new ConfigError('themes read VN equities, and no equity-vn market is registered')
  }

  return createThemeService({
    store: stores.themes,
    evidence: {
      sources: parts.sources,
      marketData: parts.marketData,
      readSeries: (options) => stores.marketData.listSeriesPoints(options),
      listNews: (options) => stores.newsArchive.listArchived(options),
      logger,
    },
    // The runner is composed after trading; resolving it per call is what the debate does too.
    analyst: {
      runner: { run: (input, options) => app.resolve('runner').run(input, options) },
      logger,
    },
    today: (now) => calendar.dayAt(now),
    chain: {
      marketData: parts.marketData,
      sources: parts.sources,
      listInstruments: (signal) =>
        stores.marketData.listInstruments({
          market: THEME_MARKET,
          status: 'active',
          kind: 'equity',
          signal,
        }),
      listQuarters: (signal) =>
        stores.marketData.listQuarterlyAccounts({ market: THEME_MARKET, signal }),
      previousSession: (day) => calendar.addTradingDays(day, -1),
      logger,
    },
    createRunBudget: () =>
      createBudget(
        Math.min(createConfiguredRunBudget(app.config).limitUsd, parts.policy.maximumCostUsd)
      ),
    logger,
  })
}
