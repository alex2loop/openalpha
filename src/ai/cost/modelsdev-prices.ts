import { z } from 'zod'

import type { ModelPrice } from '@/ai/types'
import snapshot from '@/ai/cost/modelsdev-snapshot.json'

// A negative rate is no price: `catch` reads it as absent, so the lookup falls through to the next
// source instead of charging a negative cost.
const RateSchema = z.number().nonnegative().optional().catch(undefined)

const SnapshotRowSchema = z.object({
  id: z.string(),
  cost: z
    .object({
      input: RateSchema,
      output: RateSchema,
      cache_read: RateSchema,
      cache_write: RateSchema,
    })
    .optional(),
})

// Vendored (scripts/vendor-model-prices.ts), so this is trusted build-time data, but still parsed
// through a lenient schema — a malformed row is dropped individually, not fatal, same rule as the
// OpenRouter feed (C.1). No logger at module scope: refresh the snapshot to fix a bad row.
const MODELSDEV_PRICES: ReadonlyMap<string, ModelPrice> = buildPriceMap(snapshot)

export function modelsdevPriceOf(model: string): ModelPrice | undefined {
  return MODELSDEV_PRICES.get(model)
}

function buildPriceMap(rows: readonly unknown[]): ReadonlyMap<string, ModelPrice> {
  const map = new Map<string, ModelPrice>()

  for (const raw of rows) {
    const row = SnapshotRowSchema.safeParse(raw)

    if (!row.success) {
      continue
    }

    const price = toModelPrice(row.data.cost)

    if (price !== undefined) {
      map.set(row.data.id, price)
    }
  }

  return map
}

// cost.input/output/cache_read/cache_write are already USD-per-million — direct assignment, no
// conversion (unlike OpenRouter's per-token strings).
function toModelPrice(cost: z.infer<typeof SnapshotRowSchema>['cost']): ModelPrice | undefined {
  if (cost?.input === undefined || cost.output === undefined) {
    return undefined
  }

  return {
    inPerM: cost.input,
    outPerM: cost.output,
    ...(cost.cache_read !== undefined ? { cacheReadPerM: cost.cache_read } : {}),
    ...(cost.cache_write !== undefined ? { cacheWritePerM: cost.cache_write } : {}),
  }
}
