import type { SuggestionAction } from '@/trading/kernel/conviction'
import type { Stage, StageDecision, StageInput } from '@/trading/markets/stage'
import { lowerBand } from '@/trading/kernel/conviction'
import { fundingDailyOf } from '@/trading/markets/crypto/funding'
import { CROWDED_FUNDING_DAILY_PCT, CRYPTO_MARKET_REF } from '@/trading/markets/crypto/policy'
import { loweredDecision, STAGE_PASS } from '@/trading/markets/stage'
import { PERCENT_PER_UNIT } from '@/trading/sources/rows/normalization'

const CROWDING_STAGE_ID = 'crypto-crowding'
const CROWDING_STAGE_ORDER = 10

/** A buy into longs paying extreme funding, or a sale into shorts paying it, joins the side that
 *  unwinds first when price turns. The factor already scored the lean; this is the stage that
 *  says a trade on the paying side is worth one band less, whatever the thesis. */
export function createCryptoCrowdingStage(): Stage {
  return {
    id: CROWDING_STAGE_ID,
    phase: 'risk',
    order: CROWDING_STAGE_ORDER,
    evaluate: (input) => Promise.resolve(evaluate(input)),
  }
}

function evaluate(input: StageInput): StageDecision {
  const { suggestion } = input
  const rate = fundingDailyOf(input.factors)

  if (suggestion.instrument.market !== CRYPTO_MARKET_REF || rate === undefined) {
    return STAGE_PASS
  }

  if (!isPayingSide(suggestion.action, rate)) {
    return STAGE_PASS
  }

  return loweredDecision(suggestion.conviction, lowerBand(suggestion.conviction), [
    { code: 'suggestion.crowded-side', detail: { rate: rate / PERCENT_PER_UNIT } },
  ])
}

/** Positive funding is longs paying shorts, so a buy joins the paying side there; negative is the
 *  reverse, and a sale joins it. A hold joins nothing. */
function isPayingSide(action: SuggestionAction, rate: number): boolean {
  switch (action) {
    case 'buy':
      return rate >= CROWDED_FUNDING_DAILY_PCT
    case 'reduce':
      return rate <= -CROWDED_FUNDING_DAILY_PCT
    case 'hold':
      return false
    default: {
      const exhaustive: never = action
      return exhaustive
    }
  }
}
