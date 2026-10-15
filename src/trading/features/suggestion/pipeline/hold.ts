import type { DebateResult } from '@/trading/features/suggestion/debate/types'
import type { DebateOutcome } from '@/trading/features/suggestion/pipeline/types'
import type {
  CalculationVersion,
  HoldSuggestion,
  Suggestion,
} from '@/trading/features/suggestion/types'
import type { Caveat, HoldReasonCode } from '@/trading/kernel/caveat'
import type { ConvictionBand } from '@/trading/kernel/conviction'
import {
  invalidatorsOf,
  isTraderRefusal,
  probabilityOf,
  toStoredDebate,
} from '@/trading/features/suggestion/debate/types'
import { framedDirectionOf } from '@/trading/features/suggestion/types'

interface HoldOptions {
  readonly draft: Suggestion
  readonly debate: Extract<DebateOutcome, { readonly kind: 'resolved' }>
  readonly conviction: ConvictionBand
  readonly caveats: readonly Caveat[]
  readonly versions: readonly CalculationVersion[]
  readonly holdReasonCodes: readonly HoldReasonCode[]
  readonly invalidators: readonly string[]
}

/** A draft as a hold: the side its levels were framed on is kept, and the empty thesis an
 *  actionable arm carries until `finalize` fills it is dropped rather than stored as a blank line. */
export function demoted(draft: Suggestion): Omit<HoldSuggestion, 'holdReasonCodes'> {
  const { thesis: _placeholder, ...base } = draft

  return { ...base, action: 'hold', direction: framedDirectionOf(draft) }
}

/** A thesis is carried only when the debate produced one. The stated probability is kept as on an
 *  actionable row: a hold on the floor is exactly where it is the evidence. */
export function toHold(options: HoldOptions): Suggestion {
  const { draft, debate } = options

  return {
    ...demoted(draft),
    conviction: options.conviction,
    caveats: options.caveats,
    calculationVersions: options.versions,
    citations: debate.citations,
    headlinesRead: debate.headlinesRead,
    probability: probabilityOf(debate.result),
    holdReasonCodes: options.holdReasonCodes,
    ...(debate.thesis.length === 0 ? {} : { thesis: debate.thesis }),
    ...(options.invalidators.length === 0 ? {} : { invalidators: options.invalidators }),
    ...(debate.invalidatedPrior === undefined ? {} : { invalidatedPrior: debate.invalidatedPrior }),
  }
}

type DebateHold = Extract<DebateOutcome, { readonly kind: 'hold' }>

/** Whatever the roles produced before the hold travels with it. Verification runs after the roles,
 *  so its hold arrives with their veto unread: both are recorded, or a blocking risk review reads
 *  as if it never happened. */
export function holdFrom(draft: Suggestion, debate: DebateHold): Suggestion {
  const carried = holdReasonsFor(draft, declineReasonOf(debate.result, undefined))
  const invalidators = debate.result === undefined ? [] : invalidatorsOf(debate.result)

  return {
    ...demoted(draft),
    caveats: [...draft.caveats, ...debate.caveats],
    headlinesRead: debate.headlinesRead,
    holdReasonCodes: [...new Set([debate.reasonCode, ...carried])],
    ...(invalidators.length === 0 ? {} : { invalidators }),
    ...(debate.result === undefined
      ? {}
      : { debate: toStoredDebate(debate.result), probability: probabilityOf(debate.result) }),
    ...(debate.unsupportedClaims === undefined
      ? {}
      : { unsupportedClaims: debate.unsupportedClaims }),
  }
}

/** The debate may only ever decline: manager, trader, and risk each force hold, and none can
 *  create or upgrade an action. Lean's analyst states a direction, not a verdict — bearish argues
 *  *for* a reduce — so lean holds on its claim check alone. A trader waiting names a condition the
 *  entry has not met, and the row holds on it with the conditions shown - stored as a buy it would
 *  be scored from a fill the trader said not to take. A core fill is the exception: the plan's
 *  paced steps already time it, so the wait is shown and does not hold. */
export function declineReasonOf(
  result: DebateResult | undefined,
  riskReward: number | undefined,
  coreFill = false
): HoldReasonCode | undefined {
  if (result === undefined) {
    return undefined
  }

  if (result.mode !== 'full') {
    return isBelowBreakEven(result.analyst.probability, riskReward)
      ? 'probability-below-floor'
      : undefined
  }

  const { portfolioManager, trader, risk } = result

  if (
    risk.verdict === 'block' ||
    portfolioManager.verdict === 'hold' ||
    isTraderRefusal(trader.stance, trader.sizingIntent)
  ) {
    return 'debate-declined'
  }

  if (trader.stance === 'wait' && !coreFill) {
    return 'trader-waiting'
  }

  return isBelowBreakEven(risk.probability, riskReward) ? 'probability-below-floor' : undefined
}

/** Break-even for a binary outcome: `p × reward = (1 − p) × risk` at `p = 1 / (1 + ratio)`. The
 *  stated probability is the chance the call closes positive, not the chance the target prints
 *  first, so this is a floor on expectancy rather than the expectancy itself - which is why it
 *  holds only at or under break-even and never lowers above it. A plan with no ratio has no floor;
 *  one whose reward cannot pay its own costs has a ratio at or under zero and holds at any
 *  probability. A ratio net of costs stays above -1, so the floor always divides cleanly. */
function isBelowBreakEven(probability: number, riskReward: number | undefined): boolean {
  return riskReward !== undefined && probability <= 1 / (1 + riskReward)
}

export function holdReasonsFor(
  draft: Suggestion,
  decline: HoldReasonCode | undefined
): readonly HoldReasonCode[] {
  const existing = draft.action === 'hold' ? draft.holdReasonCodes : []

  return decline === undefined ? existing : [...existing, decline]
}
