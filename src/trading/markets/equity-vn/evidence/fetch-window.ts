import type { InstrumentRef, Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { TradingCalendar } from '@/trading/markets/types'

/** The one field every coverage read shares. Bars additionally carry a close for restatement
 *  detection; flows have none, so the window resolver asks for no more than this. */
interface StoredDay {
  readonly day: TradingDay
}

interface FetchWindowOptions {
  readonly calendar: TradingCalendar
  readonly latestByTicker: ReadonlyMap<Ticker, StoredDay>
  readonly targets: readonly InstrumentRef[]
  readonly asOf: TradingDay
  readonly tailSessions: number
  /** The earliest session this kind's readers need. */
  readonly historyFromDay: TradingDay
  /** The earliest session the last settled pass covered, absent before the first one. */
  readonly storedFrom?: TradingDay
  /** The operator saying the stored series is wrong. A tail refetch cannot answer that: a series
   *  can reach the tail and still be missing sessions inside the window, which is what a provider
   *  answering one name short leaves behind and what no coverage test notices. */
  readonly forced?: boolean
}

/** `tailFromDay` is the one window every current name shares, a fixed span so the provider's
 *  market-wide read can always serve it; `rebuild` are the names whose stored history does not
 *  reach it and that must be fetched over the full window, one request each. */
interface FetchWindow {
  readonly tailFromDay: TradingDay
  readonly rebuild: readonly InstrumentRef[]
}

/** The span is fixed from `asOf` and never derived from the data: a window computed from the
 *  stalest name in the universe can exceed the market-wide read's own day ceiling, and nothing at
 *  the call site would notice it silently becoming one request per ticker. */
export function resolveFetchWindow(options: FetchWindowOptions): FetchWindow {
  const tailFromDay = options.calendar.addTradingDays(options.asOf, -options.tailSessions)

  // The only pass that re-asks for sessions already stored, so it is the one that repairs a gap.
  if (options.forced === true) {
    return { tailFromDay, rebuild: options.targets }
  }

  // A stored series that stops short of the window is current at its newest day and still too
  // shallow to read, and every name is short by the same amount, so the tail is not the repair.
  if (options.storedFrom === undefined || options.storedFrom > options.historyFromDay) {
    return { tailFromDay, rebuild: options.targets }
  }

  const rebuild = options.targets.filter((target) => {
    const latest = options.latestByTicker.get(target.ticker)

    return latest === undefined || latest.day < tailFromDay
  })

  return { tailFromDay, rebuild }
}

/** What the store covers once this pass lands: a tail refetch keeps the depth an earlier pass
 *  reached, a rebuild sets it to the window just fetched. */
export function resolveCoveredFrom(
  storedFrom: TradingDay | undefined,
  fetchedFromDay: TradingDay
): TradingDay {
  return storedFrom !== undefined && storedFrom < fetchedFromDay ? storedFrom : fetchedFromDay
}
