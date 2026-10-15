import type { ReasoningFamily } from '@/ai/catalog'
import type {
  ReasoningReplayProtocol,
  ReasoningResolution,
  ResolveReasoningInput,
} from '@/ai/reasoning/core'
import type { ReasoningMode } from '@/core/llm'
import { exact, reasoningBudgetOf, reasoningEffortOf, unknownResolution } from '@/ai/reasoning/core'
import { clampReasoningEffort } from '@/ai/reasoning/effort'
import {
  resolveAnthropic,
  resolveDeepSeek,
  resolveEffort,
  resolveGemini,
  resolveGlm,
  resolveGroq,
  resolveHighOrOff,
  resolveKimi,
  resolveOllama,
  resolveOpenAi,
  resolveOpenAiResponses,
  resolveOpenRouter,
  resolveQwen,
  resolveWafer,
  resolveXai,
} from '@/ai/reasoning/families'

export type { ReasoningReplayProtocol, ReasoningResolution } from '@/ai/reasoning/core'

export function resolveReasoning(input: ResolveReasoningInput): ReasoningResolution {
  const family = input.family

  if (family === undefined) {
    return unknownResolution(input.requested)
  }

  // A declared-mandatory endpoint rejects the disable payload, so ask it for the cheapest
  // reasoning instead and report the substitution the way every family rule does. The recursive call
  // keeps `reasoningRequired`: it asks for `low`, which never re-enters this branch.
  if (input.requested === 'off' && input.reasoningRequired === true) {
    const lowest = resolveReasoning({ ...input, requested: 'low' })

    return { ...lowest, downgradeReason: 'off_unsupported' }
  }

  if (input.requested === 'default') {
    return exact('default', {}, replayFor(family))
  }

  if (input.capability !== undefined) {
    const clamped = clampReasoningEffort(input.requested, input.capability, {
      floor: input.reasoningRequired === true ? 'low' : 'off',
    })

    if (clamped !== input.requested) {
      const resolution = resolveReasoning({ ...input, requested: clamped })
      return {
        ...resolution,
        downgradeReason: input.requested === 'off' ? 'off_unsupported' : 'unsupported_effort',
      }
    }
  }

  return resolveFamily(family, { ...input, requested: input.requested })
}

interface FamilyInput extends ResolveReasoningInput {
  readonly requested: Exclude<ReasoningMode, 'default'>
}

function resolveFamily(family: ReasoningFamily, input: FamilyInput): ReasoningResolution {
  switch (family) {
    case 'anthropic':
      return resolveAnthropic(input)
    case 'deepseek':
      return resolveDeepSeek(input)
    case 'effort':
      return resolveEffort(input.requested)
    case 'gemini':
      return resolveGemini(input)
    case 'glm':
      return resolveGlm(input.model, input.requested)
    case 'groq':
      return resolveGroq(input)
    case 'kimi':
      return resolveKimi(input.model, input.requested)
    case 'mistral':
      return resolveHighOrOff(input.requested, 'none')
    case 'ollama':
      return resolveOllama(input)
    case 'openai':
      return resolveOpenAi(input)
    case 'openai_responses':
      return resolveOpenAiResponses(input)
    case 'openrouter':
      return resolveOpenRouter(input)
    case 'qwen':
      return resolveQwen(input.model, input.requested)
    case 'wafer':
      return resolveWafer(input.requested)
    case 'xai':
      return resolveXai(input.model, input.requested)
  }
}

// A downgrade that raises the effective effort (toggle-only models resolve low/medium to high)
// consumes a larger reasoning reserve than the caller sized max_tokens for; widen the cap by the
// reserve delta so answer room survives — otherwise thinking eats the whole allowance and the
// stream ends at finish=length with zero content. Never shrinks: a downgrade to off frees room.
export function widenedMaxTokens(
  maxTokens: number,
  requested: ReasoningMode,
  effective: ReasoningMode
): number {
  const requestedReserve = reasoningReserveOf(requested)
  const effectiveReserve = reasoningReserveOf(effective)

  if (requestedReserve === undefined || effectiveReserve === undefined) {
    return maxTokens
  }
  return maxTokens + Math.max(0, effectiveReserve - requestedReserve)
}

// 'default' delegates effort to the provider — its reserve is unknowable, so no widening.
function reasoningReserveOf(mode: ReasoningMode): number | undefined {
  if (mode === 'off') {
    return 0
  }

  const effort = reasoningEffortOf(mode)
  return effort === undefined ? undefined : reasoningBudgetOf(effort)
}

function replayFor(family: ReasoningFamily): ReasoningReplayProtocol {
  switch (family) {
    case 'anthropic':
      return 'anthropic'
    case 'deepseek':
      return 'deepseek'
    case 'gemini':
      return 'gemini'
    case 'glm':
      return 'glm'
    case 'kimi':
      return 'kimi'
    case 'ollama':
      return 'ollama'
    case 'openrouter':
      return 'openrouter'
    case 'qwen':
      return 'qwen'
    case 'effort':
    case 'groq':
    case 'mistral':
    case 'openai':
    case 'openai_responses':
    case 'wafer':
    case 'xai':
      return 'none'
  }
}
