import type { FactorRequest, FactorScore } from '@/trading/kernel/factor'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { CrossSectionCache } from '@/trading/markets/equity-vn/evidence/cross-section-cache'
import type { NameEvidence } from '@/trading/markets/equity-vn/factors/factors'
import type { TradingCalendar } from '@/trading/markets/types'
import { ETF_KIND } from '@/trading/kernel/instrument'
import { isAccountsWeak } from '@/trading/markets/equity-vn/accounts/score'
import { scoreNameFactors } from '@/trading/markets/equity-vn/factors/factors'
import { DAILY_BAND_BY_EXCHANGE, PRIMARY_EXCHANGE } from '@/trading/markets/equity-vn/policy'
import { adjustedCandles, failedGates, toScreenInput } from '@/trading/markets/equity-vn/screen'
import { tapeReadings } from '@/trading/markets/equity-vn/tape/signals'
import { ceilingRunOf, toVnExchange } from '@/trading/markets/equity-vn/tradeability'
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

  const failed = failedGates(toScreenInput(evidence, options.asOf))
  const signals = tapeReadings(evidence)
  const accounts = cross.accounts.get(options.instrument.ticker)?.score

  return {
    ...scoreNameFactors(evidence, cross),
    ...(failed.length === 0 ? {} : { failedGates: failed }),
    ...(signals.length === 0 ? {} : { signals }),
    ...(isCeilingClose(evidence, cross.freshFrom, trim)
      ? { reduceSignal: 'ceiling-close' as const }
      : {}),
    ...(accounts === undefined || !accounts.decisive
      ? {}
      : { businessWeakening: isAccountsWeak(accounts) }),
  }
}

function isCeilingClose(evidence: NameEvidence, freshFrom: TradingDay, trim: CeilingTrim): boolean {
  const { record } = evidence
  const candles = adjustedCandles(evidence.bars)
  const bandPct =
    DAILY_BAND_BY_EXCHANGE[toVnExchange(record.exchange) ?? PRIMARY_EXCHANGE].maximumUpPct
  const run = ceilingRunOf(candles, {
    bandPct,
    calendar: trim.calendar,
    ...(record.listedOn === undefined ? {} : { listedOn: record.listedOn }),
  })

  // A tape that stopped before the freshness line is a ceiling close that happened sessions ago,
  // when the gap it trades on has already been paid.
  return (
    trim.sessions > 0 &&
    record.kind !== ETF_KIND &&
    (candles.at(-1)?.at ?? '') >= freshFrom &&
    run >= trim.sessions
  )
}
