import type { Stage, StageDecision, StageInput } from '@/trading/markets/stage'
import { FULLY_INVESTED_PCT_NAV } from '@/trading/features/portfolio/folds/policy'
import { STAGE_PASS } from '@/trading/markets/stage'

const DEPLOYMENT_STAGE_ID = 'deployment'
/** After exclusion, before any market's own gate: an excluded name is not worth this question. */
const DEPLOYMENT_STAGE_ORDER = 0

/** Portfolio-wide state a per-name factor cannot see. A reduce or a hold is unaffected — the block
 *  is on adding risk, not on the analysis. */
export function createDeploymentStage(): Stage {
  return {
    id: DEPLOYMENT_STAGE_ID,
    phase: 'gate',
    order: DEPLOYMENT_STAGE_ORDER,
    evaluate: (input) => Promise.resolve(evaluate(input)),
  }
}

function evaluate(input: StageInput): StageDecision {
  const nav = input.valued.navBase

  if (input.suggestion.action !== 'buy' || input.regime.regime !== 'risk-off') {
    return STAGE_PASS
  }

  // An unvalued or empty book has no deployment to measure; it is not a reason to refuse.
  if (nav === undefined || nav <= 0) {
    return STAGE_PASS
  }

  // Settled cash only, as every other spendable-cash reading does: unsettled proceeds cannot fund
  // the buy this gate is deciding on, so counting them would pass a fully deployed book.
  const deployedPctNav = 1 - input.valued.book.availableCashBase / nav

  return deployedPctNav >= FULLY_INVESTED_PCT_NAV
    ? { kind: 'block', reasonCode: 'fully-invested', caveats: [] }
    : STAGE_PASS
}
