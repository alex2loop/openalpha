import type { ReasoningResolution, ResolveReasoningInput } from '@/ai/reasoning/core'
import type { ReasoningEffort, ReasoningMode } from '@/core/llm'
import {
  downgraded,
  exact,
  reasoningBudgetOf,
  reasoningEffortOf,
  unknownResolution,
} from '@/ai/reasoning/core'

const MIN_ANTHROPIC_BUDGET = 1_024
// What a router leaves for the answer once the reasoning budget is taken off the output cap.
const MINIMUM_ANSWER_TOKENS = 1_024
// Both Claude lists are closed history, so a model released after them needs no entry: it gets the
// adaptive request every Claude since 4.6 accepts, and `off` asks for the least thinking rather than
// a `disabled` the always-thinking models (Opus 5.5, Fable 5) answer with a 400.
const CLAUDE_MODEL_RE = /(?:^|[/.])claude-/i
// Before 4.6 thinking took a token budget, which 4.7 onward rejects.
const ANTHROPIC_BUDGET_THINKING_RE =
  /claude-(?:3|(?:opus|sonnet|haiku)-4(?:[.-][015])?(?:-\d{8})?$)/i
const ANTHROPIC_DISABLE_THINKING_RE = /claude-(?:opus|sonnet)-(?:4[.-]?[6-8]|5)(?:-\d{8})?$/i
const GEMINI_25_RE = /^gemini-2\.5-/i
const GEMINI_25_PRO_RE = /^gemini-2\.5-pro/i
const GEMINI_25_PRO_MIN_BUDGET = 128
const GEMINI_LEVEL_RE = /^gemini-(?:[3-9]|\d{2})(?:\.|-)/
const GEMINI_LEVEL_PRO_RE = /^gemini-(?:[3-9]|\d{2})(?:\.\d+)?-pro/
const OPENAI_REASONING_RE = /^(?:gpt-5|o[1-9])/i
// `none` is GPT-5.1 onward: the o-series and GPT-5 itself refuse it, and codex models do not document it.
const OPENAI_NONE_EFFORT_RE = /^gpt-5\.[1-9](?!.*codex)/i
const DEEPSEEK_ALWAYS_REASONING_RE = /reasoner/i
// V3 takes no thinking fields; V4 onward takes the toggle and an effort beside it.
const DEEPSEEK_THINKING_RE = /deepseek-(?:v(?:[4-9]|\d{2})|flash)/i
const KIMI_ALWAYS_REASONING_RE = /(?:^|kimi-)(?:k2\.7|k3)/i
const KIMI_TOGGLE_RE = /kimi-k2\.6/i
const GPT_OSS_RE = /gpt-oss/i
const QWEN_RE = /qwen/i
const QWEN_PRESERVE_THINKING_RE = /qwen3\.[6-9]/i
const GLM_EFFORT_RE = /glm-5\.[2-9]/i
// GLM-5.3 onward refuses a disable; GLM-5.2 thinks at one depth only.
const GLM_NO_OFF_RE = /glm-5\.[3-9]/i
const XAI_EFFORT_RE = /grok-(?:3-mini|4\.(?:[3-9]|\d{2}))/i
// The enabled toggle each host needs to keep a replayed turn's reasoning rather than drop it.
const ENABLED_THINKING = {
  glm: { type: 'enabled', clear_thinking: false },
  kimi: { type: 'enabled', keep: 'all' },
} as const

export function resolveAnthropic(input: ResolveReasoningInput): ReasoningResolution {
  if (input.requested === 'off') {
    return resolveAnthropicOff(input.model)
  }

  const effort = reasoningEffortOf(input.requested)

  if (effort === undefined) {
    return exact('default', {}, 'anthropic')
  }

  if (!isBudgetThinkingModel(input.model)) {
    return exact(effort, toAnthropicAdaptive(effort), 'anthropic')
  }

  const budget = Math.min(reasoningBudgetOf(effort), input.maxTokens - 1)

  if (budget < MIN_ANTHROPIC_BUDGET) {
    return downgraded({
      mode: 'off',
      request: {},
      replay: 'anthropic',
      reason: 'insufficient_output_budget',
    })
  }

  return exact(effort, { thinking: { type: 'enabled', budget_tokens: budget } }, 'anthropic')
}

// Claude 5 thinks when the field is omitted, so `off` is sent explicitly; older models do not.
function resolveAnthropicOff(model: string): ReasoningResolution {
  if (isBudgetThinkingModel(model)) {
    return exact('off', {}, 'anthropic')
  }

  if (ANTHROPIC_DISABLE_THINKING_RE.test(model)) {
    return exact('off', { thinking: { type: 'disabled' } }, 'anthropic')
  }

  return downgraded({
    mode: 'low',
    request: toAnthropicAdaptive('low'),
    replay: 'anthropic',
    reason: 'off_unsupported',
  })
}

// An id that does not name Claude keeps the budget form every Anthropic-wire host has accepted.
function isBudgetThinkingModel(model: string): boolean {
  return !CLAUDE_MODEL_RE.test(model) || ANTHROPIC_BUDGET_THINKING_RE.test(model)
}

function toAnthropicAdaptive(effort: ReasoningEffort): Readonly<Record<string, unknown>> {
  return {
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort },
  }
}

export function resolveDeepSeek(input: ResolveReasoningInput): ReasoningResolution {
  if (DEEPSEEK_ALWAYS_REASONING_RE.test(input.model)) {
    const request = { thinking: { type: 'enabled' } }

    return input.requested === 'high'
      ? exact('high', request, 'deepseek')
      : downgraded({
          mode: 'high',
          request,
          replay: 'deepseek',
          reason: input.requested === 'off' ? 'off_unsupported' : 'unsupported_effort',
        })
  }

  if (!DEEPSEEK_THINKING_RE.test(input.model)) {
    return unknownResolution(input.requested)
  }

  if (input.requested === 'off') {
    return exact('off', { thinking: { type: 'disabled' } }, 'none')
  }

  const effort = reasoningEffortOf(input.requested)

  return effort === undefined
    ? exact('default', {}, 'deepseek')
    : exact(effort, { thinking: { type: 'enabled' }, reasoning_effort: effort }, 'deepseek')
}

export function resolveGemini(input: ResolveReasoningInput): ReasoningResolution {
  const effort = reasoningEffortOf(input.requested)

  if (GEMINI_25_RE.test(input.model)) {
    if (input.requested === 'off') {
      if (GEMINI_25_PRO_RE.test(input.model)) {
        // 2.5 Pro cannot disable thinking (API 400 on budget 0); floor to the documented minimum.
        return downgraded({
          mode: 'low',
          request: {
            thinkingConfig: { thinkingBudget: GEMINI_25_PRO_MIN_BUDGET, includeThoughts: false },
          },
          replay: 'gemini',
          reason: 'off_unsupported',
        })
      }

      return exact(
        'off',
        { thinkingConfig: { thinkingBudget: 0, includeThoughts: false } },
        'gemini'
      )
    }

    if (effort === undefined) {
      return exact('default', {}, 'gemini')
    }

    return exact(
      effort,
      {
        thinkingConfig: {
          thinkingBudget: reasoningBudgetOf(effort),
          includeThoughts: true,
        },
      },
      'gemini'
    )
  }

  if (GEMINI_LEVEL_RE.test(input.model)) {
    return resolveGeminiLevel(input.model, input.requested)
  }

  return unknownResolution(input.requested, 'gemini')
}

// Gemini 3 onward takes a thinking level; its Pro models accept only `low` and `high`.
function resolveGeminiLevel(model: string, requested: ReasoningMode): ReasoningResolution {
  if (requested === 'off') {
    return downgraded({
      mode: 'low',
      request: toGeminiLevel('low'),
      replay: 'gemini',
      reason: 'off_unsupported',
    })
  }

  const effort = reasoningEffortOf(requested)

  if (effort === undefined) {
    return exact('default', {}, 'gemini')
  }

  if (effort === 'medium' && GEMINI_LEVEL_PRO_RE.test(model)) {
    return downgraded({
      mode: 'low',
      request: toGeminiLevel('low'),
      replay: 'gemini',
      reason: 'unsupported_effort',
    })
  }

  return exact(effort, toGeminiLevel(effort), 'gemini')
}

function toGeminiLevel(effort: ReasoningEffort): Readonly<Record<string, unknown>> {
  return { thinkingConfig: { thinkingLevel: effort, includeThoughts: true } }
}

export function resolveGroq(input: ResolveReasoningInput): ReasoningResolution {
  if (GPT_OSS_RE.test(input.model)) {
    return input.requested === 'off'
      ? downgraded({
          mode: 'low',
          request: { reasoning_effort: 'low' },
          replay: 'none',
          reason: 'off_unsupported',
        })
      : exact(input.requested, { reasoning_effort: input.requested }, 'none')
  }

  if (QWEN_RE.test(input.model)) {
    if (input.requested === 'off') {
      return exact('off', { reasoning_effort: 'none' }, 'none')
    }

    const request = { reasoning_effort: 'default' }
    return input.requested === 'high'
      ? exact('high', request, 'none')
      : downgraded({ mode: 'high', request, replay: 'none', reason: 'unsupported_effort' })
  }

  return unknownResolution(input.requested)
}

export function resolveKimi(
  model: string,
  requested: Exclude<ReasoningMode, 'default'>
): ReasoningResolution {
  if (KIMI_ALWAYS_REASONING_RE.test(model)) {
    if (requested === 'off') {
      return downgraded({
        mode: 'low',
        request: { reasoning_effort: 'low' },
        replay: 'kimi',
        reason: 'off_unsupported',
      })
    }

    if (requested === 'medium') {
      return downgraded({
        mode: 'high',
        request: { reasoning_effort: 'high' },
        replay: 'kimi',
        reason: 'unsupported_effort',
      })
    }

    return exact(requested, { reasoning_effort: requested }, 'kimi')
  }

  // Moonshot refuses `thinking` and `reasoning_effort` in one request.
  if (KIMI_TOGGLE_RE.test(model)) {
    return resolveToggleOnly(requested, 'kimi')
  }

  return unknownResolution(requested, 'kimi')
}

export function resolveGlm(
  model: string,
  requested: Exclude<ReasoningMode, 'default'>
): ReasoningResolution {
  if (!GLM_EFFORT_RE.test(model)) {
    return resolveToggleOnly(requested, 'glm')
  }

  if (GLM_NO_OFF_RE.test(model)) {
    return { ...resolveNoOffEffort(requested), replay: 'glm' }
  }

  if (requested === 'off') {
    return exact('off', { thinking: { type: 'disabled' } }, 'glm')
  }

  const request = { reasoning_effort: 'high' }
  return requested === 'high'
    ? exact('high', request, 'glm')
    : downgraded({ mode: 'high', request, replay: 'glm', reason: 'unsupported_effort' })
}

function resolveToggleOnly(
  requested: Exclude<ReasoningMode, 'default'>,
  replay: 'glm' | 'kimi'
): ReasoningResolution {
  if (requested === 'off') {
    return exact('off', { thinking: { type: 'disabled' } }, 'none')
  }

  const request = { thinking: ENABLED_THINKING[replay] }
  return requested === 'high'
    ? exact('high', request, replay)
    : downgraded({ mode: 'high', request, replay, reason: 'unsupported_effort' })
}

export function resolveHighOrOff(
  requested: Exclude<ReasoningMode, 'default'>,
  offValue: 'none'
): ReasoningResolution {
  if (requested === 'off') {
    return exact('off', { reasoning_effort: offValue }, 'none')
  }

  const request = { reasoning_effort: 'high' }
  return requested === 'high'
    ? exact('high', request, 'none')
    : downgraded({ mode: 'high', request, replay: 'none', reason: 'unsupported_effort' })
}

export function resolveOllama(input: ResolveReasoningInput): ReasoningResolution {
  if (input.requested === 'off' && GPT_OSS_RE.test(input.model)) {
    return downgraded({
      mode: 'low',
      request: { reasoning_effort: 'low' },
      replay: 'ollama',
      reason: 'off_unsupported',
    })
  }

  const value = input.requested === 'off' ? 'none' : input.requested
  return exact(input.requested, { reasoning_effort: value }, 'ollama')
}

export function resolveOpenAi(input: ResolveReasoningInput): ReasoningResolution {
  if (!OPENAI_REASONING_RE.test(input.model)) {
    return unknownResolution(input.requested)
  }

  if (input.requested === 'off' && !OPENAI_NONE_EFFORT_RE.test(input.model)) {
    return resolveNoOffEffort(input.requested)
  }

  const value = input.requested === 'off' ? 'none' : input.requested
  return exact(input.requested, { reasoning_effort: value }, 'none')
}

export function resolveOpenAiResponses(input: ResolveReasoningInput): ReasoningResolution {
  if (input.requested === 'off') {
    return exact('off', { reasoning: { effort: 'none' } }, 'none')
  }

  const effort = reasoningEffortOf(input.requested)

  return effort === undefined
    ? unknownResolution(input.requested)
    : exact(input.requested, { reasoning: { effort, summary: 'auto' } }, 'none')
}

// A budget rather than an effort: the router spends `effort` as a share of `max_tokens`, so the
// headroom added to protect the answer would enlarge the reasoning allowance instead of fencing it.
// An endpoint that cannot reason off keeps the low budget on a short cap; the caller widens
// `max_tokens` by that reserve, so the answer keeps the room it asked for.
export function resolveOpenRouter(input: ResolveReasoningInput): ReasoningResolution {
  const { requested, maxTokens } = input
  const canDisable =
    input.reasoningRequired !== true && input.capability?.efforts.includes('off') !== false

  if (requested === 'off') {
    return exact('off', { reasoning: { enabled: false } }, 'openrouter')
  }

  const effort = reasoningEffortOf(requested)

  if (effort === undefined) {
    return unknownResolution(requested)
  }

  const budget = Math.min(reasoningBudgetOf(effort), maxTokens - MINIMUM_ANSWER_TOKENS)

  if (!canDisable && budget < reasoningBudgetOf('low')) {
    return exact('low', { reasoning: { max_tokens: reasoningBudgetOf('low') } }, 'openrouter')
  }

  if (budget < reasoningBudgetOf('low')) {
    return downgraded({
      mode: 'off',
      request: { reasoning: { enabled: false } },
      replay: 'openrouter',
      reason: 'insufficient_output_budget',
    })
  }

  return exact(requested, { reasoning: { max_tokens: budget } }, 'openrouter')
}

export function resolveQwen(
  model: string,
  requested: Exclude<ReasoningMode, 'default'>
): ReasoningResolution {
  if (requested === 'off') {
    return exact('off', { enable_thinking: false }, 'qwen')
  }

  return exact(
    requested,
    {
      enable_thinking: true,
      thinking_budget: reasoningBudgetOf(requested),
      ...(QWEN_PRESERVE_THINKING_RE.test(model) ? { preserve_thinking: true } : {}),
    },
    'qwen'
  )
}

export function resolveWafer(requested: Exclude<ReasoningMode, 'default'>): ReasoningResolution {
  return requested === 'off'
    ? exact('off', { thinking: { type: 'disabled' } }, 'none')
    : exact(requested, { reasoning_effort: requested }, 'none')
}

export function resolveXai(
  model: string,
  requested: Exclude<ReasoningMode, 'default'>
): ReasoningResolution {
  return XAI_EFFORT_RE.test(model) ? resolveNoOffEffort(requested) : unknownResolution(requested)
}

// The bare `reasoning_effort` most OpenAI-compatible hosts take, with `none` as the off switch.
export function resolveEffort(requested: Exclude<ReasoningMode, 'default'>): ReasoningResolution {
  return exact(requested, { reasoning_effort: requested === 'off' ? 'none' : requested }, 'none')
}

function resolveNoOffEffort(requested: Exclude<ReasoningMode, 'default'>): ReasoningResolution {
  return requested === 'off'
    ? downgraded({
        mode: 'low',
        request: { reasoning_effort: 'low' },
        replay: 'none',
        reason: 'off_unsupported',
      })
    : exact(requested, { reasoning_effort: requested }, 'none')
}
