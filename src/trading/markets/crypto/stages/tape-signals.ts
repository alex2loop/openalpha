import type { Caveat } from '@/trading/kernel/caveat'
import type { TapeReading } from '@/trading/kernel/market/tape'
import type { Stage, StageDecision, StageInput } from '@/trading/markets/stage'
import { CRYPTO_MARKET_REF } from '@/trading/markets/crypto/policy'
import { STAGE_PASS } from '@/trading/markets/stage'

const TAPE_SIGNALS_STAGE_ID = 'crypto-tape-signals'
const TAPE_SIGNALS_STAGE_ORDER = 20

/** Reports, never decides: a washout that held or a rally on new leverage is a reason to wait, and
 *  the score already carried the reading here so nothing is fetched twice. */
export function createCryptoTapeSignalsStage(): Stage {
  return {
    id: TAPE_SIGNALS_STAGE_ID,
    phase: 'tradeability',
    order: TAPE_SIGNALS_STAGE_ORDER,
    evaluate: (input) => Promise.resolve(evaluate(input)),
  }
}

function evaluate(input: StageInput): StageDecision {
  if (input.suggestion.instrument.market !== CRYPTO_MARKET_REF || input.signals === undefined) {
    return STAGE_PASS
  }

  const caveats = input.signals.flatMap(toCaveats)

  return caveats.length === 0 ? STAGE_PASS : { kind: 'pass', caveats }
}

/** Only this market's own signals have a sentence here; a reading another market's tape publishes
 *  cannot reach a crypto suggestion, and is dropped rather than mis-described if it ever did. */
function toCaveats(reading: TapeReading): readonly Caveat[] {
  switch (reading.signal) {
    case 'washout-held':
      return [
        {
          code: 'market.washout-held',
          detail: { day: reading.day, volume: reading.measure, fall: Math.abs(reading.run) },
        },
      ]
    case 'leverage-led':
      return [
        {
          code: 'market.leverage-led',
          detail: { day: reading.day, leverage: reading.measure, run: reading.run },
        },
      ]
    default:
      return []
  }
}
