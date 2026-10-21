import type { FactorRequest, FactorScore } from '@/trading/kernel/factor'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { CrossSectionCache } from '@/trading/markets/equity-vn/evidence/cross-section-cache'
import type { ScreenInput } from '@/trading/markets/equity-vn/screen'
import type { TradingCalendar } from '@/trading/markets/types'
import { ETF_KIND } from '@/trading/kernel/instrument'
import { isAccountsWeak } from '@/trading/markets/equity-vn/accounts/score'
import { scoreNameFactors } from '@/trading/markets/equity-vn/factors/factors'
import { DAILY_BAND_BY_EXCHANGE } from '@/trading/markets/equity-vn/policy'
import { adjustedCandles, failedGates, toScreenInput } from '@/trading/markets/equity-vn/screen'
import { tapeReadings } from '@/trading/markets/equity-vn/tape/signals'
import { ceilingRunOf } from '@/trading/markets/equity-vn/tradeability'
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

  const screen = toScreenInput(evidence, options.asOf)
  const failed = failedGates(screen)
  const signals = tapeReadings(evidence)
  const accounts = cross.accounts.get(options.instrument.ticker)?.score

  return {
    ...scoreNameFactors(evidence, cross),
    ...(failed.length === 0 ? {} : { failedGates: failed }),
    ...(signals.length === 0 ? {} : { signals }),
    ...(isCeilingClose(screen, cross.freshFrom, trim)
      ? { reduceSignal: 'ceiling-close' as const }
      : {}),
    ...(accounts === undefined || !accounts.decisive
      ? {}
      : { businessWeakening: isAccountsWeak(accounts) }),
  }
}

function isCeilingClose(screen: ScreenInput, freshFrom: TradingDay, trim: CeilingTrim): boolean {
  if (trim.sessions <= 0 || screen.kind === ETF_KIND) {
    return false
  }

  const candles = adjustedCandles(screen.bars)

  // A tape that stopped before the freshness line is a ceiling close that happened sessions ago,
  // when the gap it trades on has already been paid.
  if ((candles.at(-1)?.at ?? '') < freshFrom) {
    return false
  }

  const run = ceilingRunOf(candles, {
    bandPct: DAILY_BAND_BY_EXCHANGE[screen.exchange].maximumUpPct,
    calendar: trim.calendar,
    ...(screen.listedOn === undefined ? {} : { listedOn: screen.listedOn }),
  })

  return run >= trim.sessions
}
