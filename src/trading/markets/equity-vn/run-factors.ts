import type { FactorRequest, FactorScore } from '@/trading/kernel/factor'
import type { CrossSectionCache } from '@/trading/markets/equity-vn/evidence/cross-section-cache'
import type { NameEvidence } from '@/trading/markets/equity-vn/factors/name-evidence'
import type { TradingCalendar } from '@/trading/markets/types'
import { isAccountsWeak } from '@/trading/markets/equity-vn/accounts/score'
import { scoreNameFactors } from '@/trading/markets/equity-vn/factors/factors'
import { UNSCORED_COMPOSITE } from '@/trading/markets/factor-scoring'

interface CeilingTrim {
  readonly sessions: number
  readonly calendar: TradingCalendar
}

export async function runFactors(
  cache: CrossSectionCache,
  options: FactorRequest,
  trim: CeilingTrim
): Promise<FactorScore> {
  const cross = await cache.get(options.asOf, options.signal)
  const evidence = cross.byTicker.get(options.instrument.ticker)

  // Outside the ranked universe: nothing scored, and the draft must say so rather than carry a
  // silent zero into the debate.
  if (evidence === undefined) {
    return { ...UNSCORED_COMPOSITE, results: [], caveats: [{ code: 'market-data.no-coverage' }] }
  }

  const { failedGates, tapeReadings: signals } = evidence
  const accounts = cross.accounts.get(options.instrument.ticker)?.score

  return {
    ...scoreNameFactors(evidence, cross),
    ...(failedGates.length === 0 ? {} : { failedGates }),
    ...(signals.length === 0 ? {} : { signals }),
    ...(isCeilingClose(evidence, options.now, trim)
      ? { reduceSignal: 'ceiling-close' as const }
      : {}),
    ...(accounts === undefined || !accounts.decisive
      ? {}
      : { businessWeakening: isAccountsWeak(accounts) }),
  }
}

function isCeilingClose(evidence: NameEvidence, now: number, trim: CeilingTrim): boolean {
  const { ceilingRun, lastAdjustedAt } = evidence

  if (trim.sessions <= 0 || ceilingRun === undefined || lastAdjustedAt === undefined) {
    return false
  }

  // The gap is paid at the next open; once that open has passed there is nothing left to trim.
  return (
    now < trim.calendar.sessionOpenAt(trim.calendar.addTradingDays(lastAdjustedAt, 1)) &&
    ceilingRun >= trim.sessions
  )
}
