import type { Stage, StageDecision, StageInput } from '@/trading/markets/stage'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { STAGE_PASS } from '@/trading/markets/stage'

const EXCLUSION_STAGE_ID = 'profile-exclusion'
/** Ahead of every market's own gate: an excluded name is not worth a tradeability question. */
const EXCLUSION_STAGE_ORDER = -1

/** The operator's exclusion list, enforced. Cross-market by nature, so the pipeline owns it rather
 *  than any one market. */
export function createExclusionStage(): Stage {
  return {
    id: EXCLUSION_STAGE_ID,
    phase: 'gate',
    order: EXCLUSION_STAGE_ORDER,
    evaluate: (input) => Promise.resolve(evaluate(input)),
  }
}

function evaluate(input: StageInput): StageDecision {
  const key = buildInstrumentKey(input.suggestion.instrument)
  const excluded = input.profile.exclusions.some((entry) => buildInstrumentKey(entry) === key)

  return excluded ? { kind: 'block', reasonCode: 'excluded-instrument', caveats: [] } : STAGE_PASS
}
