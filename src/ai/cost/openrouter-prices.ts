import { z } from 'zod'

import type { ModelPrice } from '@/ai/types'

export const PriceRowSchema = z.object({
  id: z.string(),
  pricing: z
    .object({
      prompt: z.string().optional(),
      completion: z.string().optional(),
      input_cache_read: z.string().optional(),
      input_cache_write: z.string().optional(),
    })
    .optional(),
})

const PER_TOKEN_TO_PER_MILLION = 1e6

// OpenRouter prices per-token, as USD strings; every other feed and override is per-million, so this
// is the one conversion site.
export function toModelPrice(row: z.infer<typeof PriceRowSchema>): ModelPrice | undefined {
  const p = row.pricing
  const inPerM = perMillion(p?.prompt)
  const outPerM = perMillion(p?.completion)

  if (inPerM === undefined || outPerM === undefined) {
    return undefined
  }

  const cacheReadPerM = perMillion(p?.input_cache_read)
  const cacheWritePerM = perMillion(p?.input_cache_write)

  return {
    inPerM,
    outPerM,
    ...(cacheReadPerM === undefined ? {} : { cacheReadPerM }),
    ...(cacheWritePerM === undefined ? {} : { cacheWritePerM }),
  }
}

// Every rate is finite-checked, not just prompt/completion: a non-numeric cache rate would otherwise
// become NaN and silently poison every charge computed from it. A negative rate is no price either:
// OpenRouter's router models publish "-1" for a cost that depends on the routed model.
function perMillion(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  const perM = Number(value) * PER_TOKEN_TO_PER_MILLION
  return Number.isFinite(perM) && perM >= 0 ? perM : undefined
}

let cache: ReadonlyMap<string, ModelPrice> = new Map()

// An empty map is a failed fetch, so it never replaces a good one.
export function cacheOpenRouterPrices(prices: ReadonlyMap<string, ModelPrice>): void {
  if (prices.size === 0) {
    return
  }

  cache = prices
}

export function openRouterPriceOf(model: string): ModelPrice | undefined {
  return cache.get(model)
}
