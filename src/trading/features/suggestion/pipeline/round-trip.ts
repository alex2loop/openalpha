import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { ClosedRoundTrip } from '@/trading/kernel/operator/book'
import type { Stage, StageDecision, StageInput } from '@/trading/markets/stage'
import type { TradingCalendar } from '@/trading/markets/types'
import { lowerBand } from '@/trading/kernel/conviction'
import { isSameInstrument } from '@/trading/kernel/instrument'
import { loweredDecision, STAGE_PASS } from '@/trading/markets/stage'

const ROUND_TRIP_STAGE_ID = 'round-trip'
/** After averaging-down: that stage judges adding to a position still open, this one judges
 *  reopening one already closed, and no draft can be both. */
const ROUND_TRIP_STAGE_ORDER = 50

/** How far back a buy looks for the operator's own closed round trips in this name. A month of
 *  sessions - the span the outcome window measures over, and the one an operator still remembers
 *  exiting in. A chosen value, like the averaging-down threshold beside it; no backtest justifies
 *  20 over 18. */
const ROUND_TRIP_WINDOW_SESSIONS = 20

/** Closed round trips inside that window that still read as position management. Past it, the name
 *  is being traded in and out rather than held. */
const MAXIMUM_ROUND_TRIPS = 2

/** The first session the re-entry read covers. Inclusive, so the window is exactly
 *  `ROUND_TRIP_WINDOW_SESSIONS` sessions counting `asOf` itself. */
export function roundTripWindowStart(calendar: TradingCalendar, asOf: TradingDay): TradingDay {
  return calendar.addTradingDays(asOf, -ROUND_TRIP_WINDOW_SESSIONS + 1)
}

/** The operator's own closed round trips in this name, newest last. Flattened across venues and
 *  re-sorted: the fold groups by position key, so a name held at two venues arrives grouped rather
 *  than dated, and every caller wants the most recent one. */
export function recentRoundTripsOf(
  closedRoundTrips: readonly ClosedRoundTrip[],
  instrument: InstrumentRef,
  since: TradingDay
): readonly ClosedRoundTrip[] {
  return closedRoundTrips
    .filter((trip) => isSameInstrument(trip.instrument, instrument) && trip.closedAt >= since)
    .toSorted((left, right) => left.closedAt.localeCompare(right.closedAt))
}

/** Buying back a name the operator just sold at a loss rests the entry on the thesis the exit
 *  abandoned, and repeated round trips in one name pay fees and spread for the privilege. Neither
 *  blocks: re-entry on a fresh signal is sound, and refusing it would encode the reluctance the
 *  evidence says costs money rather than correct it. No ETF exemption, unlike averaging-down - the
 *  finding is about what the operator keeps doing in this name, not about a single-name thesis the
 *  price is contradicting. */
export function createRoundTripStage(): Stage {
  return {
    id: ROUND_TRIP_STAGE_ID,
    phase: 'risk',
    order: ROUND_TRIP_STAGE_ORDER,
    evaluate: (input) => Promise.resolve(evaluate(input)),
  }
}

function evaluate(input: StageInput): StageDecision {
  const { suggestion } = input

  if (suggestion.action !== 'buy') {
    return STAGE_PASS
  }

  const since = roundTripWindowStart(input.market.manifest.calendar, suggestion.at)
  const trips = recentRoundTripsOf(input.closedRoundTrips, suggestion.instrument, since)
  const caveats = [...exitCaveat(trips), ...churnCaveat(trips)]

  if (caveats.length === 0) {
    return STAGE_PASS
  }

  return loweredDecision(suggestion.conviction, lowerBand(suggestion.conviction), caveats)
}

/** Only the closing sale that lost money. A profitable exit inside the window is a finished trade,
 *  not a warning about the next one. */
function exitCaveat(trips: readonly ClosedRoundTrip[]): readonly Caveat[] {
  const last = trips.at(-1)

  if (last === undefined || last.realizedFraction >= 0) {
    return []
  }

  return [
    {
      code: 'suggestion.recent-exit',
      detail: {
        realizedLoss: -last.realizedFraction,
        sessions: ROUND_TRIP_WINDOW_SESSIONS,
      },
    },
  ]
}

function churnCaveat(trips: readonly ClosedRoundTrip[]): readonly Caveat[] {
  if (trips.length <= MAXIMUM_ROUND_TRIPS) {
    return []
  }

  return [
    {
      code: 'suggestion.round-trip-churn',
      detail: { count: trips.length, sessions: ROUND_TRIP_WINDOW_SESSIONS },
    },
  ]
}
