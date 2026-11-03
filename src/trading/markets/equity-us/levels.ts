import type { LevelResult, MarketLevelRequest } from '@/trading/kernel/factor'
import type { MarketDeps } from '@/trading/markets/deps'
import { ETF_KIND } from '@/trading/kernel/instrument'
import { isLeveragedFund } from '@/trading/markets/equity-us/leveraged'
import {
  US_FUND_LEVEL_POLICY,
  US_LEVEL_POLICY,
  US_MARKET_REF,
  US_TICK,
} from '@/trading/markets/equity-us/policy'
import { resolveLevelPolicy } from '@/trading/markets/level-settings'
import { buildLevels } from '@/trading/markets/levels'

/** A fund is reviewed, never stopped: its level is a place to look again, not an exit armed against
 *  the wrapper. A leveraged or inverse fund is the exception, because it is never bought: only a
 *  held one reaches here, and a holder needs a real stop on something that decays. */
export async function buildUsLevels(
  deps: MarketDeps,
  request: MarketLevelRequest
): Promise<LevelResult> {
  const record = await deps.marketDataStore.findInstrument({
    instrument: request.instrument,
    signal: request.signal,
  })

  if (record === null) {
    return { kind: 'unavailable', reasonCode: 'insufficient-data' }
  }

  const reviewed = record.kind === ETF_KIND && !isLeveragedFund(record)
  const result = buildLevels({
    ...request,
    policy: resolveLevelPolicy(
      reviewed ? US_FUND_LEVEL_POLICY : US_LEVEL_POLICY,
      deps.config.markets[US_MARKET_REF]
    ),
    tickSize: US_TICK,
  })

  return result.kind === 'available' && reviewed
    ? { ...result, levels: { ...result.levels, reviewOnly: true } }
    : result
}
