import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { MarketEvent, MarketEventKind } from '@/trading/kernel/market/market-event'
import type { Stage, StageDecision, StageInput } from '@/trading/markets/stage'
import {
  isBlockingFiling,
  isFlaggedFiling,
  RECENT_EVENT_LOOKBACK_DAYS,
} from '@/trading/kernel/market/market-event'
import { shiftCalendarDay } from '@/trading/markets/calendar'
import { US_MARKET_REF } from '@/trading/markets/equity-us/policy'
import { STAGE_PASS } from '@/trading/markets/stage'

const FILINGS_STAGE_ID = 'equity-us-filings'
const FILINGS_STAGE_ORDER = 60

/** Every answer on a name with a flagged 8-K item in the lookback carries the filing, so the reader
 *  is told to read it. Bankruptcy and non-reliance on past financials also hold a buy, in the risk
 *  phase after the debate so a held name still gets its thesis; selling stays open and nothing sells
 *  for it. It runs after the earnings stage, so a block keeps that caveat. It only restrains:
 *  without SEC configured, or on a failed read, it finds no rows and passes, and the brief already
 *  says filings are off. */
export function createUsFilingsStage(): Stage {
  return {
    id: FILINGS_STAGE_ID,
    phase: 'risk',
    order: FILINGS_STAGE_ORDER,
    evaluate: (input) => Promise.resolve(evaluate(input)),
  }
}

function evaluate(input: StageInput): StageDecision {
  const { suggestion } = input

  if (suggestion.instrument.market !== US_MARKET_REF) {
    return STAGE_PASS
  }

  const flagged = newestPerKind(input.events ?? [], suggestion.at)

  if (flagged.length === 0) {
    return STAGE_PASS
  }

  const caveats = flagged.map(toCaveat)

  return suggestion.action !== 'reduce' && flagged.some(isBlockingFiling)
    ? { kind: 'block', reasonCode: 'filing-flagged', caveats }
    : { kind: 'pass', caveats }
}

function newestPerKind(events: readonly MarketEvent[], asOf: TradingDay): readonly MarketEvent[] {
  const earliest = shiftCalendarDay(asOf, -RECENT_EVENT_LOOKBACK_DAYS)
  const newest = new Map<MarketEventKind, MarketEvent>()

  for (const event of events) {
    if (!isFlaggedFiling(event) || event.at < earliest || event.at > asOf) {
      continue
    }

    const held = newest.get(event.kind)

    if (held === undefined || event.at > held.at) {
      newest.set(event.kind, event)
    }
  }

  return [...newest.values()]
}

function toCaveat(event: MarketEvent): Caveat {
  return { code: 'market.filing-flagged', detail: { filing: event.kind, day: event.at } }
}
