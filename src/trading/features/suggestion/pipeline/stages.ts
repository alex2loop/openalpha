import type { Suggestion } from '@/trading/features/suggestion/types'
import type { HoldReasonCode } from '@/trading/kernel/caveat'
import type { Stage, StageDecision, StageInput, StagePhase } from '@/trading/markets/stage'
import { abortError, isAbortError, ValidationError } from '@/core/errors'
import { scrubCredentials } from '@/core/security/credentials'
import { demoted } from '@/trading/features/suggestion/pipeline/hold'
import { BAND_RANK, isConvictionBand } from '@/trading/kernel/conviction'

const MAXIMUM_STAGE_ERROR_CHARS = 200

export type StageRunResult =
  | { readonly kind: 'block'; readonly draft: Suggestion; readonly reasonCode: HoldReasonCode }
  | { readonly kind: 'pass'; readonly draft: Suggestion }

interface StageRunOptions {
  readonly phases: readonly StagePhase[]
  readonly input: Omit<StageInput, 'suggestion'>
  readonly draft: Suggestion
}

/** Runs every registered stage whose phase is in `phases`, in registry order, against one draft.
 *  A `block` stops the walk immediately and the caller persists a hold. `runSuggestion` calls this
 *  twice — `['gate']` before debate and `['tradeability', 'risk']` after — so the monotonicity and
 *  blocking rules are enforced by one function rather than two copies that could drift. */
export async function runStages(
  stages: readonly Stage[],
  options: StageRunOptions
): Promise<StageRunResult> {
  const { signal } = options.input
  let draft = options.draft

  for (const stage of stages) {
    if (!options.phases.includes(stage.phase)) {
      continue
    }

    if (signal.aborted) {
      throw abortError(signal)
    }

    const decision = await evaluateStage(stage, { ...options.input, suggestion: draft })

    if (decision.kind === 'block') {
      return { kind: 'block', reasonCode: decision.reasonCode, draft: blocked(draft, decision) }
    }

    draft = applyDecision(draft, decision)
  }

  return { kind: 'pass', draft }
}

/** A stage that throws — a source outage, a schema mismatch, anything that is not the stage's own
 *  considered decision — becomes the same block outcome under the existing generic reason code.
 *  "A blocked stage forces hold" has to survive an infrastructure failure exactly as it survives a
 *  considered block; a stage that can throw must not silently pass a candidate through. An abort
 *  propagates untouched: cancellation is not a stage decision. */
async function evaluateStage(stage: Stage, input: StageInput): Promise<StageDecision> {
  try {
    return await stage.evaluate(input)
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    return {
      kind: 'block',
      reasonCode: 'stage-blocked',
      caveats: [
        {
          code: 'stage.threw',
          detail: { stage: stage.id, error: stageErrorDetail(err) },
        },
      ],
    }
  }
}

/** A stage can only pass, lower, or block. It cannot rewrite identity, thesis, levels, or size, and
 *  it never returns a mutated suggestion — this applies the decision instead. */
function applyDecision(
  current: Suggestion,
  decision: Exclude<StageDecision, { readonly kind: 'block' }>
): Suggestion {
  if (decision.kind === 'pass') {
    return { ...current, caveats: [...current.caveats, ...decision.caveats] }
  }

  if (!isConvictionBand(decision.conviction)) {
    throw new ValidationError(`stage returned an unknown conviction band: ${decision.conviction}`)
  }

  // Strictly below. A stage returning the same or a higher band is a programming error, not a
  // no-op — accepting it silently would make stage order load-bearing. Membership is checked first
  // so an unrecognized string cannot slip past by producing an undefined rank.
  if (BAND_RANK[decision.conviction] >= BAND_RANK[current.conviction]) {
    throw new ValidationError(`stage raised conviction from ${current.conviction}`)
  }

  return {
    ...current,
    conviction: decision.conviction,
    caveats: [
      ...current.caveats,
      ...decision.caveats,
      { code: 'suggestion.conviction-lowered', detail: { to: decision.conviction } },
    ],
  }
}

function blocked(
  current: Suggestion,
  decision: Extract<StageDecision, { readonly kind: 'block' }>
): Suggestion {
  return {
    ...demoted(current),
    caveats: [...current.caveats, ...decision.caveats],
    holdReasonCodes: [...new Set([...holdReasonsOf(current), decision.reasonCode])],
  }
}

function holdReasonsOf(current: Suggestion): readonly HoldReasonCode[] {
  return current.action === 'hold' ? current.holdReasonCodes : []
}

function stageErrorDetail(err: unknown): string {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : 'unknown stage failure'

  return scrubCredentials(message).slice(0, MAXIMUM_STAGE_ERROR_CHARS)
}
