import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { CrossSectionCache } from '@/trading/markets/equity-vn/evidence/cross-section-cache'
import type { Stage, StageDecision, StageInput } from '@/trading/markets/stage'
import { MS_PER_DAY } from '@/core/utils/time'
import { nextDisclosure } from '@/trading/markets/disclosure-calendar'
import {
  REPORT_NOTICE_DAYS,
  REPORT_OVERDUE_DAYS,
  VN_MARKET_REF,
} from '@/trading/markets/equity-vn/policy'
import { STAGE_PASS } from '@/trading/markets/stage'

const DISCLOSURE_STAGE_ID = 'equity-vn-disclosure'
const DISCLOSURE_STAGE_ORDER = 30

/** What the reporting calendar says about this name: the next statutory deadline when it lands
 *  close enough to matter, and the accounts on file when the issuer has already missed one. Neither
 *  changes conviction - a deadline applies to the whole market and says nothing about direction, and
 *  a late filing describes the evidence rather than the business. */
export function createVnDisclosureStage(crossSection: CrossSectionCache): Stage {
  return {
    id: DISCLOSURE_STAGE_ID,
    phase: 'risk',
    order: DISCLOSURE_STAGE_ORDER,
    evaluate: (input) => evaluate(crossSection, input),
  }
}

async function evaluate(cache: CrossSectionCache, input: StageInput): Promise<StageDecision> {
  const { suggestion } = input

  if (suggestion.instrument.market !== VN_MARKET_REF) {
    return STAGE_PASS
  }

  const section = await cache.get(suggestion.at, input.signal)
  const reportedOn = section.byTicker.get(suggestion.instrument.ticker)?.fundamental?.reportedOn
  const caveats = [...dueCaveats(suggestion.at), ...overdueCaveats(suggestion.at, reportedOn)]

  return caveats.length === 0 ? STAGE_PASS : { kind: 'pass', caveats }
}

function dueCaveats(at: TradingDay): readonly Caveat[] {
  const upcoming = nextDisclosure(at)

  if (upcoming === undefined || !isWithinDays(at, upcoming.dueBy, REPORT_NOTICE_DAYS)) {
    return []
  }

  return [{ code: 'market.report-due', detail: { day: upcoming.dueBy } }]
}

/** Absent accounts are not late accounts: a name the provider returned no statement row for is
 *  already reported by the quality factor's own missing-input caveat, and claiming an overdue
 *  filing on evidence that never arrived names a failure the issuer did not commit. */
function overdueCaveats(at: TradingDay, reportedOn: TradingDay | undefined): readonly Caveat[] {
  if (reportedOn === undefined || isWithinDays(reportedOn, at, REPORT_OVERDUE_DAYS)) {
    return []
  }

  return [{ code: 'market.report-overdue', detail: { day: reportedOn } }]
}

/** Positive test rather than a negated one: an unparseable day yields NaN, which fails every
 *  comparison, so a negated form would fall through and state a deadline it could not date. */
function isWithinDays(from: string, to: string, days: number): boolean {
  const elapsed = Math.round((Date.parse(to) - Date.parse(from)) / MS_PER_DAY)

  return Number.isFinite(elapsed) && elapsed <= days
}
