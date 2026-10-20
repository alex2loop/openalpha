import type { MarketDeps } from '@/trading/markets/deps'
import type { Stage, StageDecision, StageInput } from '@/trading/markets/stage'
import { isLeveragedFund } from '@/trading/markets/equity-us/leveraged'
import { US_MARKET_REF } from '@/trading/markets/equity-us/policy'
import { STAGE_PASS } from '@/trading/markets/stage'

const LEVERAGED_FUND_STAGE_ID = 'equity-us-leveraged-fund'
const LEVERAGED_FUND_STAGE_ORDER = 40

/** Never suggest buying a leveraged or inverse fund. It runs in the risk phase, after the debate,
 *  so a held fund still gets its thesis, and it blocks a buy only: a hold or a reduce on a held
 *  fund is untouched. */
export function createUsLeveragedFundStage(deps: MarketDeps): Stage {
  return {
    id: LEVERAGED_FUND_STAGE_ID,
    phase: 'risk',
    order: LEVERAGED_FUND_STAGE_ORDER,
    evaluate: (input) => evaluate(deps, input),
  }
}

async function evaluate(deps: MarketDeps, input: StageInput): Promise<StageDecision> {
  const { suggestion } = input

  if (suggestion.instrument.market !== US_MARKET_REF || suggestion.action !== 'buy') {
    return STAGE_PASS
  }

  const record = await deps.marketDataStore.findInstrument({
    instrument: suggestion.instrument,
    signal: input.signal,
  })

  if (record === null || !isLeveragedFund(record)) {
    return STAGE_PASS
  }

  return {
    kind: 'block',
    reasonCode: 'leveraged-fund',
    caveats: [{ code: 'market.leveraged-fund' }],
  }
}
