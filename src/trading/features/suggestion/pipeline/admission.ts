import type { Caveat, HoldReasonCode } from '@/trading/kernel/caveat'
import type { ScreenGateCode } from '@/trading/kernel/screen-codes'
import type { AdmissionPolicy } from '@/trading/markets/admission'
import type { Stage, StageDecision, StageInput } from '@/trading/markets/stage'
import { lowerBand } from '@/trading/kernel/conviction'
import { loweredDecision, STAGE_PASS } from '@/trading/markets/stage'

const ADMISSION_STAGE_ID = 'admission'
/** Ahead of every market's own gate and behind the two portfolio-wide ones: a name this market
 *  would not rank is not worth a solvency question, and an excluded one is not worth this. */
const ADMISSION_STAGE_ORDER = 1

/** The screen's admission rules applied to a directly named ticker. Discovery runs every candidate
 *  through its market's gates, but `/suggest VNM` reaches the pipeline without them, so a halted or
 *  barely-traded name would be analysed and sized on evidence the market refuses to rank. The gates
 *  themselves are the market's; this owns only what a failed one costs. */
export function createAdmissionStage(): Stage {
  return {
    id: ADMISSION_STAGE_ID,
    phase: 'gate',
    order: ADMISSION_STAGE_ORDER,
    evaluate: (input) => Promise.resolve(evaluate(input)),
  }
}

function evaluate(input: StageInput): StageDecision {
  const policy = input.market.manifest.admission
  const failed = input.failedGates ?? []

  if (policy === undefined || failed.length === 0) {
    return STAGE_PASS
  }

  const blocked = blockingReason(policy, failed)

  if (blocked !== undefined) {
    return { kind: 'block', reasonCode: blocked, caveats: [] }
  }

  const caveats = loweringCaveats(policy, failed)

  if (caveats.length === 0) {
    return STAGE_PASS
  }

  // One band per gate: thin turnover, a float nobody can exit through and a pumped tape are three
  // separate reasons to trust a name less, and discounting them once said the same of all three.
  const { conviction } = input.suggestion

  return loweredDecision(conviction, lowerBand(conviction, caveats.length), caveats)
}

/** The market's own gate order decides which block is reported: the first gate it lists that the
 *  name fails is the most fundamental one, exactly as its screen reports it. */
function blockingReason(
  policy: AdmissionPolicy,
  failed: readonly ScreenGateCode[]
): HoldReasonCode | undefined {
  for (const code of failed) {
    const reason = policy.blocking[code]

    if (reason !== undefined) {
      return reason
    }
  }

  return undefined
}

function loweringCaveats(
  policy: AdmissionPolicy,
  failed: readonly ScreenGateCode[]
): readonly Caveat[] {
  return failed.flatMap((code) => {
    const caveat = policy.lowering[code]

    return caveat === undefined ? [] : [{ code: caveat }]
  })
}
