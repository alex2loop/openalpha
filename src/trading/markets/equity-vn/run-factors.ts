import type { FactorRequest, FactorScore } from '@/trading/kernel/factor'
import type { CrossSectionCache } from '@/trading/markets/equity-vn/evidence/cross-section-cache'
import { isAccountsWeak } from '@/trading/markets/equity-vn/accounts/score'
import { scoreNameFactors } from '@/trading/markets/equity-vn/factors/factors'
import { failedGates, toScreenInput } from '@/trading/markets/equity-vn/screen'
import { tapeReadings } from '@/trading/markets/equity-vn/tape/signals'
import { UNSCORED_COMPOSITE } from '@/trading/markets/factor-scoring'

export async function runFactors(
  cache: CrossSectionCache,
  options: FactorRequest
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
    ...(accounts === undefined || !accounts.decisive
      ? {}
      : { businessWeakening: isAccountsWeak(accounts) }),
  }
}
