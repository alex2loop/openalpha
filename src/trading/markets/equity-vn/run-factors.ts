import type { FactorRequest, FactorScore } from '@/trading/kernel/factor'
import type { CrossSectionCache } from '@/trading/markets/equity-vn/evidence/cross-section-cache'
import { ETF_KIND } from '@/trading/kernel/instrument'
import { isAccountsWeak } from '@/trading/markets/equity-vn/accounts/score'
import { scoreNameFactors } from '@/trading/markets/equity-vn/factors/factors'
import { DAILY_BAND_BY_EXCHANGE, PRIMARY_EXCHANGE } from '@/trading/markets/equity-vn/policy'
import { adjustedCandles, failedGates, toScreenInput } from '@/trading/markets/equity-vn/screen'
import { tapeReadings } from '@/trading/markets/equity-vn/tape/signals'
import { ceilingRunOf, toVnExchange } from '@/trading/markets/equity-vn/tradeability'
import { UNSCORED_COMPOSITE } from '@/trading/markets/factor-scoring'

export async function runFactors(
  cache: CrossSectionCache,
  options: FactorRequest,
  trimSessions: number
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
  const bandPct =
    DAILY_BAND_BY_EXCHANGE[toVnExchange(evidence.record.exchange) ?? PRIMARY_EXCHANGE].maximumUpPct
  const candles = adjustedCandles(evidence.bars)
  // A tape that stopped before the freshness line is a ceiling close that happened sessions ago,
  // when the gap it trades on has already been paid.
  const ceilingClose =
    trimSessions > 0 &&
    evidence.record.kind !== ETF_KIND &&
    (candles.at(-1)?.at ?? '') >= cross.freshFrom &&
    ceilingRunOf(candles, bandPct) >= trimSessions

  return {
    ...scoreNameFactors(evidence, cross),
    ...(failed.length === 0 ? {} : { failedGates: failed }),
    ...(signals.length === 0 ? {} : { signals }),
    ...(ceilingClose ? { reduceSignal: 'ceiling-close' as const } : {}),
    ...(accounts === undefined || !accounts.decisive
      ? {}
      : { businessWeakening: isAccountsWeak(accounts) }),
  }
}
