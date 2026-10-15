import type { TradingDay } from '@/trading/kernel/instrument'
import type { MarketDeps } from '@/trading/markets/deps'
import type { TradingCalendar } from '@/trading/markets/types'
import {
  CONTINUOUS_CALENDAR,
  createTradingCalendar,
  resolveSettledDay,
} from '@/trading/markets/calendar'
import {
  FX_STRESS_SCAN_SESSIONS,
  FX_STRESS_SESSIONS,
  VN_BRIEF_FX_PAIR,
  VN_FX_SERIES,
} from '@/trading/markets/equity-vn/policy'

/** The pair keeps the world's clock, not the board's: a VN session closes while the rate is still
 *  trading, so only this can say which of its days is done. */
const FX_CALENDAR = createTradingCalendar(CONTINUOUS_CALENDAR)

interface FxSeriesRefresh {
  readonly deps: MarketDeps
  /** The market's own, so the window is counted in its sessions rather than in calendar days. */
  readonly calendar: TradingCalendar
  readonly asOf: TradingDay
  /** The operator re-basing the series on purpose; an ordinary pass leaves a stored day alone. */
  readonly forced: boolean
  readonly now: number
  readonly signal: AbortSignal
}

/** The USD/VND series' only writer. The whole window is fetched each pass rather than one point
 *  appended: the confirmer reads a session a month back, so an appended series is silent for its
 *  first month and silent again after any reset. A provider that cannot answer
 *  leaves the series as it stands and the confirmer says it has no history. */
export async function refreshFxSeries(input: FxSeriesRefresh): Promise<void> {
  const { calendar, asOf } = input
  // Never past the pair's own last finished day. The board settles hours before the rate does, so
  // asking for the board's day returns a bar still forming, and the point below is written once and
  // then left alone — freezing whatever the rate happened to be at the first pass of the evening.
  const settled = resolveSettledDay(FX_CALENDAR, input.now)
  const toDay = asOf < settled ? asOf : settled
  const fromDay = calendar.addTradingDays(toDay, -(FX_STRESS_SESSIONS + FX_STRESS_SCAN_SESSIONS))
  const history = await input.deps.sources.resolve({
    kind: 'fxHistory',
    context: { ticker: VN_BRIEF_FX_PAIR, fromDay, toDay },
    signal: input.signal,
  })

  if (history.kind !== 'available') {
    return
  }

  for (const point of history.value) {
    await input.deps.marketDataStore.upsertSeriesPoint({
      seriesId: VN_FX_SERIES,
      day: point.day,
      value: point.rate,
      replace: input.forced,
      now: input.now,
      signal: input.signal,
    })
  }
}
