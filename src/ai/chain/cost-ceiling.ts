import type { Pricing } from '@/ai/cost/pricing'
import type { ChainEntry } from '@/ai/types'
import type { ResolvedLlm } from '@/core/config/resolve'
import type { ProviderChain, ReasoningMode } from '@/core/llm'
import { cacheRatesOf } from '@/ai/cost/pricing'
import { widenedMaxTokens } from '@/ai/reasoning/resolve'

const CEILING_PER_MILLION = 1_000_000

type CostEstimate = Parameters<ProviderChain['estimateMaxCost']>[0]

interface CeilingInput {
  readonly entries: readonly ChainEntry[]
  readonly tuning: ResolvedLlm
  readonly pricing: Pricing
}

// The most the chain may spend on one request: every entry, retried to its ladder limit. The
// ledger bound and this ceiling must agree — an estimate short of what the chain can actually
// spend admits a request past its cap.
export function estimateChainCeiling(deps: CeilingInput, request: CostEstimate): number {
  const attemptsPerEntry = maxAttemptsPerEntry(deps.tuning, request.hasOutputContract)
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

    ceilingUsd += costUsd * attemptsPerEntry
  }

  return ceilingUsd
}

export function attemptCeiling(entries: number, tuning: ResolvedLlm, contracted: boolean): number {
  return entries * maxAttemptsPerEntry(tuning, contracted)
}

// An entry that refuses the output contract runs a second ladder without it, so a contracted
// request is allowed two ladders per entry.
function maxAttemptsPerEntry(tuning: ResolvedLlm, hasOutputContract: boolean): number {
  const ladders = hasOutputContract ? 2 : 1

  return (tuning.maxRetries + 1) * ladders
}

// Prices what the chain will actually permit: a downgraded entry widens max_tokens by the reserve
// delta, so the pre-call ceiling has to widen with it.
function entryOutputTokens(entry: ChainEntry, requested: ReasoningMode, maxTokens: number): number {
  const capped = Math.min(entry.maxTokens ?? maxTokens, maxTokens)
  const mode = requested === 'default' ? entry.reasoningMode : requested

  return widenedMaxTokens(capped, mode, entry.reasoningResolution.effectiveMode)
}
