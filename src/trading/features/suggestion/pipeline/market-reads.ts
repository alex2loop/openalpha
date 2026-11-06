import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { MarketEvent } from '@/trading/kernel/market/market-event'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { Market } from '@/trading/markets/types'
import {
  instrumentEvents,
  recentEvents,
  upcomingEvents,
} from '@/trading/features/suggestion/pipeline/draft-input'
import { longestOutcomeWindowSessions } from '@/trading/features/suggestion/pipeline/outcome-window'
import { standingMarginEvent } from '@/trading/kernel/market/margin-status'
import { eventsFromDay } from '@/trading/kernel/market/market-event'
import { isSourceFailed } from '@/trading/kernel/source/source-result'

interface InstrumentEventsRead {
  readonly market: Market
  readonly instrument: InstrumentRef
  readonly asOf: TradingDay
  readonly now: number
  readonly signal: AbortSignal
}

/** The corporate calendar of one name, read back far enough that the margin row in force is inside
 *  it. Undefined where the market has no events capability. */
export function readInstrumentEvents(
  read: InstrumentEventsRead
): Promise<SourceResult<readonly MarketEvent[]> | undefined> | undefined {
  const { market, instrument, asOf } = read

  return market.capabilities.events?.run({
    instrument,
    // The range end, not the run day: `runEvents` asks the capability as of it, so a forward
    // reader sees nothing unless this reaches past today.
    asOf: market.manifest.calendar.addTradingDays(
      asOf,
      longestOutcomeWindowSessions(market.manifest.defaultCalendar)
    ),
    now: read.now,
    fromDay: eventsFromDay(market.manifest.calendar, asOf),
    signal: read.signal,
  })
}

/** One read of this name's events answers both halves a draft needs. */
export interface DraftCalendar {
  readonly events: readonly MarketEvent[]
  /** Past rows too: an ex-date the stored series has not caught up to moves today's levels. */
  readonly instrumentEvents: readonly MarketEvent[]
  readonly recent: readonly MarketEvent[]
  readonly standingMargin?: MarketEvent
  readonly calendarFailed?: true
}

export function toDraftCalendar(
  events: SourceResult<readonly MarketEvent[]> | undefined,
  instrument: InstrumentRef,
  asOf: TradingDay
): DraftCalendar {
  const own = instrumentEvents(events, instrument)
  const standing = standingMarginEvent(own, asOf)

  return {
    events: upcomingEvents(own, asOf),
    instrumentEvents: own,
    recent: recentEvents(own, asOf),
    ...(standing === undefined ? {} : { standingMargin: standing }),
    ...(isSourceFailed(events) ? { calendarFailed: true } : {}),
  }
}
