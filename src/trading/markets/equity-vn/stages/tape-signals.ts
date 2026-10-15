import type { Caveat } from '@/trading/kernel/caveat'
import type { TapeReading } from '@/trading/kernel/market/tape'
import type { Stage, StageDecision, StageInput } from '@/trading/markets/stage'
import { VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'
import { STAGE_PASS } from '@/trading/markets/stage'

const TAPE_SIGNALS_STAGE_ID = 'equity-vn-tape-signals'
const TAPE_SIGNALS_STAGE_ORDER = 25

/** Reports, never decides: a desk stepping away is a reason to wait or to tighten, and which of the
 *  two is the operator's call with the date in hand. The score already carried the reading here,
 *  so nothing is fetched twice. */
export function createVnTapeSignalsStage(): Stage {
  return {
    id: TAPE_SIGNALS_STAGE_ID,
    phase: 'tradeability',
    order: TAPE_SIGNALS_STAGE_ORDER,
    evaluate: (input) => Promise.resolve(evaluate(input)),
  }
}

function evaluate(input: StageInput): StageDecision {
  if (input.suggestion.instrument.market !== VN_MARKET_REF || input.signals === undefined) {
    return STAGE_PASS
  }

  const caveats = input.signals.flatMap(toCaveats)

  return caveats.length === 0 ? STAGE_PASS : { kind: 'pass', caveats }
}

/** Only this market's own signals have a sentence here; a reading another market's tape publishes
 *  cannot reach a VN suggestion, and is dropped rather than mis-described if it ever did. */
function toCaveats(reading: TapeReading): readonly Caveat[] {
  switch (reading.signal) {
    case 'foreign-flip':
      return [
        {
          code: 'market.foreign-flip',
          detail: { day: reading.day, share: reading.measure, run: reading.run },
        },
      ]
    default:
      return []
  }
}
