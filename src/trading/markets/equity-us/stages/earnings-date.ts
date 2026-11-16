import type { Stage, StageDecision, StageInput } from '@/trading/markets/stage'
import { orderSessionOf } from '@/trading/markets/calendar'
import { US_EVENT_HORIZON_SESSIONS, US_MARKET_REF } from '@/trading/markets/equity-us/policy'
import { STAGE_PASS } from '@/trading/markets/stage'

const EARNINGS_DATE_STAGE_ID = 'equity-us-earnings-date'
const EARNINGS_DATE_STAGE_ORDER = 50

/** A report inside the event horizon can open the price past the stop, so a buy carries the date.
 *  It never lowers or blocks: the date says nothing about direction, and every company reports each
 *  quarter. A calendar that failed or a name it does not list reads as no caveat; the debate's
 *  evidence already says when the calendar could not be read. */
export function createUsEarningsDateStage(): Stage {
  return {
    id: EARNINGS_DATE_STAGE_ID,
    phase: 'risk',
    order: EARNINGS_DATE_STAGE_ORDER,
    evaluate: (input) => Promise.resolve(evaluate(input)),
  }
}

function evaluate(input: StageInput): StageDecision {
  const { suggestion, market } = input

  if (suggestion.instrument.market !== US_MARKET_REF || suggestion.action !== 'buy') {
    return STAGE_PASS
  }

  const { calendar } = market.manifest
  // The session an order placed now fills in: a report already out by the close is behind it.
  const session = orderSessionOf(calendar, input.now)
  const last = calendar.addTradingDays(session, US_EVENT_HORIZON_SESSIONS)
  const report = input.events?.find(
    (event) => event.kind === 'earnings-date' && event.at >= session && event.at <= last
  )

  return report === undefined
    ? STAGE_PASS
    : { kind: 'pass', caveats: [{ code: 'market.earnings-upcoming', detail: { day: report.at } }] }
}
