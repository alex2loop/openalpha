import { z } from 'zod'

import type { ModelReasoningCapability, ReasoningEffortLevel } from '@/ai/reasoning/effort'
import type { ModelPrice } from '@/ai/types'
import type { Logger } from '@/core/logging/logger'
import { PriceRowSchema, toModelPrice } from '@/ai/cost/openrouter-prices'
import { keylessGetWithSignal } from '@/core/http-client'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_HOUR } from '@/core/utils/time'

const FEED_HOSTS: readonly string[] = Object.freeze(['https://openrouter.ai'])
const FEED_PATH = '/api/v1/models'
/** Without it the feed lists text models only, and a decisions model such as `typesafe/jev-1.14`
 *  falls to the fallback price. */
const FEED_OUTPUT_MODALITIES = 'text,decisions'
const FEED_FETCH_TIMEOUT_MS = 5_000
const FEED_MAXIMUM_BYTES = 4_194_304
const FEED_RETRY_COOLDOWN_MS = 60_000
// Prices from this feed settle spend against the daily/monthly caps, so a daemon running for weeks
// must not enforce them against a boot-time snapshot.
const FEED_TTL_MS = 6 * MS_PER_HOUR
const STRUCTURED_OUTPUTS_PARAMETER = 'structured_outputs'

const CapabilityRowSchema = z.object({
  id: z.string(),
  reasoning: z
    .object({
      mandatory: z.boolean().optional(),
      supported_efforts: z.array(z.string()).optional(),
    })
    .nullish(),
})

const StructuredOutputRowSchema = z.object({
  id: z.string(),
  supported_parameters: z.array(z.string()).nullish(),
})

const EFFORT_MAP: Record<string, ReasoningEffortLevel | undefined> = {
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  // xhigh, max, none: deliberately unmapped, so a list of only those pins the model to what it can do
}

const MANDATORY_EFFORTS: readonly ReasoningEffortLevel[] = ['low', 'medium', 'high']

let cached: readonly unknown[] | undefined
let inflight: Promise<readonly unknown[]> | undefined
let refreshAtMs = 0

// Single-flight, shared by all derivations below, caching the raw (top-level-validated, still
// per-row-unknown) rows until the TTL. An empty result means the fetch failed — the feed is never
// legitimately empty — so the last good catalog is kept and retried after a short cooldown, rather
// than a transient outage pinning [] or discarding prices the caps are enforced against.
function loadRawRows(logger: Logger): Promise<readonly unknown[]> {
  if (inflight !== undefined) {
    return inflight
  }

  const startedAtMs = Date.now()

  if (startedAtMs < refreshAtMs) {
    return Promise.resolve(cached ?? [])
  }

  // Cleared in `finally`, not in the success arm: a throw here would otherwise leave a rejected
  // promise pinned in `inflight` and fail every later lookup for the life of the process.
  inflight = fetchRawRows(logger)
    .then((rows) => {
      const fetched = rows.length > 0

      if (fetched) {
        cached = rows
      }

      refreshAtMs = startedAtMs + (fetched ? FEED_TTL_MS : FEED_RETRY_COOLDOWN_MS)

      return cached ?? []
    })
    .finally(() => {
      inflight = undefined
    })

  return inflight
}

async function fetchRawRows(logger: Logger): Promise<readonly unknown[]> {
  try {
    const text = await keylessGetWithSignal({
      hosts: FEED_HOSTS,
      path: FEED_PATH,
      query: { output_modalities: FEED_OUTPUT_MODALITIES },
      maxBytes: FEED_MAXIMUM_BYTES,
      signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
      toolName: 'openrouter models',
    })
    const parsed = z.object({ data: z.array(z.unknown()) }).safeParse(JSON.parse(text))

    return parsed.success ? parsed.data.data : []
  } catch (err: unknown) {
    logger.warn('ai.capabilities_unavailable', { err: formatErrForLog(err) })

    return []
  }
}

/** True once the TTL (or the failure cooldown) has run out and no fetch is under way. */
export function isOpenRouterFeedDue(): boolean {
  return inflight === undefined && Date.now() >= refreshAtMs
}

export function loadOpenRouterCapabilities(
  logger: Logger
): Promise<ReadonlyMap<string, ModelReasoningCapability>> {
  return loadRawRows(logger).then(toCapabilityMap)
}

export function loadOpenRouterPrices(logger: Logger): Promise<ReadonlyMap<string, ModelPrice>> {
  return loadRawRows(logger).then(toPriceMap)
}

/** Model ids whose routed endpoints enforce a JSON schema server-side. */
export function loadOpenRouterStructuredOutputs(logger: Logger): Promise<ReadonlySet<string>> {
  return loadRawRows(logger).then(toStructuredOutputSet)
}

function toCapabilityMap(rows: readonly unknown[]): ReadonlyMap<string, ModelReasoningCapability> {
  const map = new Map<string, ModelReasoningCapability>()
  for (const raw of rows) {
    const row = CapabilityRowSchema.safeParse(raw)
    if (!row.success) {
      continue
    }
    const reasoning = row.data.reasoning
    if (reasoning === null || reasoning === undefined) {
      continue
    }

    const mandatory = reasoning.mandatory === true
    const efforts = availableEfforts(reasoning.supported_efforts, mandatory)

    if (efforts === undefined) {
      continue
    }

    map.set(row.data.id, { efforts })
  }
  return map
}

function toStructuredOutputSet(rows: readonly unknown[]): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const raw of rows) {
    const row = StructuredOutputRowSchema.safeParse(raw)
    if (row.success && row.data.supported_parameters?.includes(STRUCTURED_OUTPUTS_PARAMETER)) {
      ids.add(row.data.id)
    }
  }
  return ids
}

function toPriceMap(rows: readonly unknown[]): ReadonlyMap<string, ModelPrice> {
  const map = new Map<string, ModelPrice>()
  for (const raw of rows) {
    const row = PriceRowSchema.safeParse(raw)
    if (!row.success) {
      continue
    }
    const price = toModelPrice(row.data)
    if (price !== undefined) {
      map.set(row.data.id, price)
    }
  }
  return withBareTails(map)
}

// Every feed id is vendor-qualified, so a bare configured id — the form the catalog ships — matches
// nothing without this. A tail two vendors both claim is left out instead of picking one's price.
function withBareTails(exact: ReadonlyMap<string, ModelPrice>): ReadonlyMap<string, ModelPrice> {
  const claims = new Map<string, number>()

  for (const id of exact.keys()) {
    const tail = bareTail(id)
    claims.set(tail, (claims.get(tail) ?? 0) + 1)
  }

  const map = new Map(exact)
  for (const [id, price] of exact) {
    const tail = bareTail(id)

    if (claims.get(tail) === 1 && !map.has(tail)) {
      map.set(tail, price)
    }
  }

  return map
}

function bareTail(id: string): string {
  return id.slice(id.lastIndexOf('/') + 1)
}

/** `undefined` when the feed enumerates nothing: a model whose entry omits `supported_efforts` has
 *  not been described, which is not the same as one described as unable to reason. An enumerated
 *  list that maps to nothing has been described, and pins the model to what it can do. A mandatory
 *  flag alone still says the one thing that matters: the endpoint refuses `off`. */
function availableEfforts(
  supported: readonly string[] | undefined,
  mandatory: boolean
): readonly ReasoningEffortLevel[] | undefined {
  if (supported === undefined) {
    return mandatory ? MANDATORY_EFFORTS : undefined
  }

  const mapped = [...new Set(supported.map((e) => EFFORT_MAP[e]).filter((e) => e !== undefined))]

  if (mapped.length === 0) {
    return mandatory ? ['low'] : ['off']
  }

  return mandatory ? mapped : ['off', ...mapped]
}
