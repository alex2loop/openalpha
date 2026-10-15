import type { TradingDay } from '@/trading/kernel/instrument'
import type { Quote, SessionSoFar } from '@/trading/kernel/market/market-data'
import type { IntradaySession, LiveIndexReading } from '@/trading/kernel/market/market-overview'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { TradingCalendar } from '@/trading/markets/types'
import { formatZonedTime, isRecentObservation } from '@/trading/markets/calendar'

/** The settled session a reading must beat, and the clock its age is measured against. */
export interface ReadingClock {
  readonly settledDay: TradingDay
  readonly now: number
}

/** Where an instrument trades now, beside the settled close its row reports. Absent unless the
 *  reading is genuinely fresher than that close, so a shut market never restates the close as
 *  current, and absent whenever the read itself failed — an overview stands whole without it.
 *
 *  Fresher by the *session* the reading belongs to rather than by its instant, because a closing
 *  auction prints minutes after the bell; and recent enough that the feed is still advancing,
 *  because a provider stuck on a morning bar answers with today's date all afternoon. The session
 *  is the caller's, which already holds it, and the age is `isRecentObservation`'s, which owns that
 *  budget for every surface. */
export function toLiveReading(
  quote: SourceResult<Quote>,
  calendar: TradingCalendar,
  clock: ReadingClock
): LiveIndexReading | undefined {
  if (quote.kind !== 'available') {
    return undefined
  }

  if (
    calendar.dayAt(quote.value.observedAt) <= clock.settledDay ||
    !isRecentObservation(calendar, quote.value.observedAt, clock.now)
  ) {
    return undefined
  }

  const { price, changePct, observedAt, session } = quote.value
  const timezone = calendar.timezone
  const intraday = session === undefined ? undefined : toIntradaySession(session, timezone)

  return {
    price,
    observedAt,
    observedOn: calendar.dayAt(observedAt),
    observedTime: formatZonedTime(observedAt, timezone),
    ...(changePct === undefined ? {} : { changePct }),
    ...(intraday === undefined ? {} : { session: intraday }),
  }
}

function toIntradaySession(session: SessionSoFar, timezone: string): IntradaySession | undefined {
  const { fromAt, ...recorded } = session

  return fromAt === undefined
    ? undefined
    : { ...recorded, fromTime: formatZonedTime(fromAt, timezone) }
}
