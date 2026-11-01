import type { Locale } from '@/core/types/locale'
import type {
  NavBarReader,
  NavHistory,
  NavHistoryOptions,
  NavService,
  NavSnapshot,
  NavSnapshotStore,
  NavWindow,
} from '@/trading/features/portfolio/nav/types'
import type { ProfileService } from '@/trading/features/profile/types'
import type { TradingConfig } from '@/trading/kernel/config'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { MarketRegistry } from '@/trading/markets/types'
import { dayInZone } from '@/core/utils/time'
import { buildBenchmark } from '@/trading/features/portfolio/nav/benchmark'
import { toDrawdowns, toNavIndex, toPeriodReturn } from '@/trading/features/portfolio/nav/measures'
import { NAV_WINDOW_DAYS } from '@/trading/features/portfolio/nav/types'
import { tradingDay } from '@/trading/kernel/instrument'
import { shiftCalendarDay } from '@/trading/markets/calendar'

interface NavServiceDeps {
  readonly store: Pick<NavSnapshotStore, 'list'>
  readonly profiles: Pick<ProfileService, 'get'>
  readonly markets: MarketRegistry
  readonly marketDataStore: NavBarReader
  readonly config: Pick<TradingConfig, 'baseCurrency'>
  readonly timezone: string
  readonly defaultLocale: Locale
}

function resolveFromDay(window: NavWindow, now: number, timezone: string): TradingDay | undefined {
  return window === 'all'
    ? undefined
    : shiftCalendarDay(tradingDay(dayInZone(now, timezone)), -NAV_WINDOW_DAYS[window])
}

function firstDayOf(all: readonly NavSnapshot[]): { readonly firstDay?: TradingDay } {
  const first = all[0]

  return first === undefined ? {} : { firstDay: first.day }
}

async function readHistory(deps: NavServiceDeps, options: NavHistoryOptions): Promise<NavHistory> {
  const baseCurrency = deps.config.baseCurrency
  const all = await deps.store.list({ baseCurrency, signal: options.signal })
  const fromDay = resolveFromDay(options.window, options.now, deps.timezone)
  const snapshots = fromDay === undefined ? all : all.filter((snapshot) => snapshot.day >= fromDay)
  const points = toNavIndex(snapshots)
  const indexes = points.map((point) => point.index)
  const base = {
    window: options.window,
    baseCurrency,
    points,
    recordedCount: all.length,
    ...firstDayOf(all),
  }

  if (points.length < 2) {
    return base
  }

  const drawdowns = toDrawdowns(indexes)
  const periodReturn = toPeriodReturn(indexes)
  const profile = await deps.profiles.get({
    signal: options.signal,
  })
  const benchmark = await buildBenchmark(deps, profile.segmentTargets, {
    days: points.map((point) => point.day),
    signal: options.signal,
  })

  return {
    ...base,
    ...(periodReturn === undefined ? {} : { periodReturn }),
    maximumDrawdown: drawdowns.maximum,
    currentDrawdown: drawdowns.current,
    ...(benchmark.kind === 'ready'
      ? { benchmark: benchmark.benchmark }
      : { benchmarkGap: benchmark.gap }),
  }
}

export function createNavService(deps: NavServiceDeps): NavService {
  return { history: (options) => readHistory(deps, options) }
}
