import type { ReasoningFamily } from '@/ai/catalog'
import type { ModelReasoningCapability } from '@/ai/reasoning/effort'
import type { ReasoningEffort, ReasoningMode, ReasoningTextProtocol } from '@/core/llm'

const REASONING_BUDGETS = {
  low: 1024,
  medium: 4096,
  high: 16384,
} as const satisfies Record<ReasoningEffort, number>

export type ReasoningReplayProtocol = 'none' | 'anthropic' | 'gemini' | ReasoningTextProtocol

type ReasoningDowngradeReason =
  | 'insufficient_output_budget'
  | 'off_unsupported'
  | 'unsupported_effort'
  | 'unsupported_model'

export interface ReasoningResolution {
  readonly effectiveMode: ReasoningMode
  readonly request: Readonly<Record<string, unknown>>
  readonly replay: ReasoningReplayProtocol
  readonly downgradeReason?: ReasoningDowngradeReason
}

export interface ResolveReasoningInput {
  readonly model: string
  readonly requested: ReasoningMode
  readonly maxTokens: number
  readonly family?: ReasoningFamily
  // `[[models]] reasoning_required`: the endpoint mandates reasoning. Family rules infer this from
  // the model name where they can (gpt-oss, kimi-k3, gemini-3); a router provider cannot, because
  // the same family serves every model behind it.
  readonly reasoningRequired?: boolean
  readonly capability?: ModelReasoningCapability
}

export function reasoningEffortOf(mode: ReasoningMode): ReasoningEffort | undefined {
  return mode === 'default' || mode === 'off' ? undefined : mode
}

export function reasoningBudgetOf(effort: ReasoningEffort): number {
  return REASONING_BUDGETS[effort]
}

export function exact(
  mode: ReasoningMode,
  request: Readonly<Record<string, unknown>>,
  replay: ReasoningReplayProtocol
): ReasoningResolution {
  return { effectiveMode: mode, request: Object.freeze(request), replay }
}

export function downgraded(input: {
  readonly mode: ReasoningMode
  readonly request: Readonly<Record<string, unknown>>
  readonly replay: ReasoningReplayProtocol
  readonly reason: ReasoningDowngradeReason
}): ReasoningResolution {
  return {
    effectiveMode: input.mode,
    request: Object.freeze(input.request),
    replay: input.replay,
    downgradeReason: input.reason,
  }
}

export function unknownResolution(
  requested: ReasoningMode,
  replay: ReasoningReplayProtocol = 'none'
): ReasoningResolution {
  if (requested === 'default') {
    return exact('default', {}, replay)
  }

  return downgraded({
    mode: 'default',
    request: {},
    replay,
    reason: 'unsupported_model',
  })
}
