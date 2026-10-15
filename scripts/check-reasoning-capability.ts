#!/usr/bin/env bun
// A reasoning payload the endpoint rejects costs a whole run (OpenRouter answers 400 "Reasoning is
// mandatory for this endpoint and cannot be disabled"), so the disable path is checked here rather
// than in production. `[[models]] reasoning_required` is the declaration; these assert it is honored,
// stays inert everywhere else, and survives config resolution. The router is asked for a token
// budget rather than an effort, because it spends an effort as a share of `max_tokens`.
import type { ModelReasoningCapability } from '@/ai/reasoning/effort'
import { clampReasoningEffort } from '@/ai/reasoning/effort'
import { resolveReasoning } from '@/ai/reasoning/resolve'
import { resolveModel } from '@/core/config/resolvers/model'

const MAX_TOKENS = 8_192
const API_KEY_ENV = 'OPENALPHA_REASONING_CHECK_KEY'

let failures = 0

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`ok   ${name}`)
    return
  }

  failures++
  console.error(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

function resolve(
  requested: 'off' | 'high',
  reasoningRequired?: boolean
): ReturnType<typeof resolveReasoning> {
  return resolveReasoning({
    model: 'openai/gpt-oss-120b',
    requested,
    maxTokens: MAX_TOKENS,
    family: 'openrouter',
    ...(reasoningRequired === undefined ? {} : { reasoningRequired }),
  })
}

const declared = resolve('off', true)

check(
  'a declared-mandatory model never receives a disable payload',
  JSON.stringify(declared.request) === JSON.stringify({ reasoning: { max_tokens: 1024 } }),
  JSON.stringify(declared.request)
)
check(
  'the substitution is reported as a downgrade',
  declared.effectiveMode === 'low' && declared.downgradeReason === 'off_unsupported',
  `${declared.effectiveMode}/${declared.downgradeReason}`
)

const undeclared = resolve('off')

check(
  'an undeclared model still disables reasoning',
  JSON.stringify(undeclared.request) === JSON.stringify({ reasoning: { enabled: false } }) &&
    undeclared.downgradeReason === undefined,
  JSON.stringify(undeclared.request)
)

const requestedHigh = resolve('high', true)

// Not high's own 16.384: the budget is capped at what `MAX_TOKENS` leaves once the answer's share
// is reserved, or the endpoint has nothing left to answer with when it finishes thinking.
check(
  'the flag is inert when reasoning was not turned off',
  JSON.stringify(requestedHigh.request) === JSON.stringify({ reasoning: { max_tokens: 7_168 } }) &&
    requestedHigh.downgradeReason === undefined,
  JSON.stringify(requestedHigh.request)
)

process.env[API_KEY_ENV] = 'reasoning-check'
const resolved = resolveModel({
  entry: {
    provider: 'openrouter',
    model: 'openai/gpt-oss-120b',
    api_key_env: API_KEY_ENV,
    reasoning_required: true,
    reasoning: 'off',
  },
  path: ['models', 0],
})

check(
  'the entry declaration survives config resolution',
  resolved.reasoningRequired === true && resolved.reasoningMode === 'off',
  `${resolved.reasoningRequired}/${resolved.reasoningMode}`
)

// B.2 clamp fixtures — inline ModelReasoningCapability values, no network.
const mandatoryCapability: ModelReasoningCapability = {
  efforts: ['low', 'medium', 'high'],
}
const noneListingCapability: ModelReasoningCapability = {
  efforts: ['off', 'low', 'medium', 'high'],
}

const mandatoryOff = resolveReasoning({
  model: 'some/mandatory-model',
  requested: 'off',
  maxTokens: MAX_TOKENS,
  family: 'openrouter',
  capability: mandatoryCapability,
})

check(
  '(a) mandatory capability clamps off up to low, reported off_unsupported',
  mandatoryOff.effectiveMode === 'low' && mandatoryOff.downgradeReason === 'off_unsupported',
  `${mandatoryOff.effectiveMode}/${mandatoryOff.downgradeReason}`
)

check(
  '(b) off stays off on a non-mandatory model listing none',
  clampReasoningEffort('off', noneListingCapability) === 'off'
)

check(
  '(c) an unavailable effort searches up first',
  clampReasoningEffort('medium', { efforts: ['off', 'high'] }) === 'high'
)

check(
  '(d) an unavailable effort searches down when nothing higher is available',
  clampReasoningEffort('high', { efforts: ['off', 'low'] }) === 'low'
)

const noCapability = resolveReasoning({
  model: 'openai/gpt-oss-120b',
  requested: 'off',
  maxTokens: MAX_TOKENS,
  family: 'openrouter',
})

check(
  '(e) absent capability leaves the family regex path unchanged',
  JSON.stringify(noCapability.request) === JSON.stringify({ reasoning: { enabled: false } }) &&
    noCapability.downgradeReason === undefined,
  JSON.stringify(noCapability.request)
)

if (failures > 0) {
  console.error(`\nreasoning capability: ${failures} failure(s)`)
  process.exit(1)
}

console.log('\nreasoning capability: PASS')
