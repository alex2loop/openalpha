import type { Pricing } from '@/ai/cost/pricing'
import type { ChainEntry } from '@/ai/types'
import type { ResolvedLlm } from '@/core/config/resolve'
import type { LLMRequest, ProviderChain, ReasoningMode } from '@/core/llm'
import { cacheRatesOf } from '@/ai/cost/pricing'
import { widenedMaxTokens } from '@/ai/reasoning/resolve'

const CEILING_PER_MILLION = 1_000_000

type CostEstimate = Parameters<ProviderChain['estimateMaxCost']>[0]
type LadderRequest = Pick<CostEstimate, 'hasOutputContract' | 'reasoningMode'>

interface CeilingInput {
  readonly entries: readonly ChainEntry[]
  readonly tuning: ResolvedLlm
  readonly pricing: Pricing
}

// The most the chain may spend on one request: every entry, retried to its ladder limit. The
// ledger bound and this ceiling must agree — an estimate short of what the chain can actually
// spend admits a request past its cap.
export function estimateChainCeiling(deps: CeilingInput, request: CostEstimate): number {
  let ceilingUsd = 0

  for (const entry of deps.entries) {
    const { price } = deps.pricing.priceOf({ provider: entry.provider.id, model: entry.model })
    const outputTokens = entryOutputTokens(entry, request.reasoningMode, request.maxTokens)
    const cache = cacheRatesOf(price)
    const costUsd =
      (request.inputTokens * price.inPerM +
        outputTokens * price.outPerM +
        request.cacheReadTokens * cache.readPerM +
        request.cacheWriteTokens * cache.writePerM) /
      CEILING_PER_MILLION

    ceilingUsd += costUsd * maxAttemptsPerEntry(deps.tuning, entry, request)
  }

  return ceilingUsd
}

export function attemptCeiling(
  entries: readonly ChainEntry[],
  tuning: ResolvedLlm,
  req: Pick<LLMRequest, 'outputContract' | 'reasoningMode'>
): number {
  const request = {
    hasOutputContract: req.outputContract !== undefined,
    reasoningMode: req.reasoningMode,
  }

  return entries.reduce((sum, entry) => sum + maxAttemptsPerEntry(tuning, entry, request), 0)
}

// An entry that refuses a field it was sent (the output contract, or a reasoning field) runs a
// second ladder without it, and never a third. A request sending neither has nothing to refuse.
function maxAttemptsPerEntry(
  tuning: ResolvedLlm,
  entry: ChainEntry,
  request: LadderRequest
): number {
  const mode = request.reasoningMode === 'default' ? entry.reasoningMode : request.reasoningMode
  const refusable = request.hasOutputContract || mode !== 'default'

  return (tuning.maxRetries + 1) * (refusable ? 2 : 1)
}

// Prices what the chain will actually permit: a downgraded entry widens max_tokens by the reserve
// delta, so the pre-call ceiling has to widen with it.
function entryOutputTokens(entry: ChainEntry, requested: ReasoningMode, maxTokens: number): number {
  const capped = Math.min(entry.maxTokens ?? maxTokens, maxTokens)
  const mode = requested === 'default' ? entry.reasoningMode : requested

  return widenedMaxTokens(capped, mode, entry.reasoningResolution.effectiveMode)
}
