import type { RawModel, RawModelDefaults } from '@/core/config/schema'
import type { ProviderRouting, ReasoningMode } from '@/core/llm'
import { MissingEnvError, OperatorConfigError } from '@/core/config/operator-errors'

const MODEL_SELECTOR_SEPARATOR = ':'

export interface ResolvedModelPrices {
  readonly inPerM: number
  readonly outPerM: number
  readonly cacheReadPerM?: number
  readonly cacheWritePerM?: number
}

export interface ResolvedModel {
  readonly selector: string
  readonly provider: string
  readonly model: string
  readonly apiKey?: string
  /** The variable the key is read from, set or not. */
  readonly apiKeyEnv?: string
  /** Set only by a deferred resolve: the chain refuses the call instead of the boot. */
  readonly missingEnv?: string
  readonly baseUrl?: string
  readonly prices?: ResolvedModelPrices
  readonly reasoningMode: ReasoningMode
  readonly reasoningRequired?: boolean
  readonly providerRouting?: ProviderRouting
  readonly maxTokens?: number
  readonly ttftTimeoutMs?: number
  readonly streamIdleTimeoutMs?: number
}

/** The one model entry under the client source: the connected MCP client answers every call. */
export const CLIENT_MODEL_PROVIDER = 'client'
export const CLIENT_MODEL: ResolvedModel = Object.freeze({
  selector: `${CLIENT_MODEL_PROVIDER}${MODEL_SELECTOR_SEPARATOR}${CLIENT_MODEL_PROVIDER}`,
  provider: CLIENT_MODEL_PROVIDER,
  model: CLIENT_MODEL_PROVIDER,
  reasoningMode: 'default',
})

type MutableModel = { -readonly [K in keyof ResolvedModel]: ResolvedModel[K] }

export interface ResolveModelInput {
  readonly entry: RawModel
  readonly defaults?: RawModelDefaults
  readonly path: readonly (string | number)[]
  /** An unset key env var is not a config error; the chain registry skips a tier that needs it. */
  readonly apiKeyOptional?: true
  /** An unset key env var is recorded on the entry rather than thrown. */
  readonly deferMissingKey?: true
}

export function resolveModel(input: ResolveModelInput): ResolvedModel {
  const { entry, defaults, path } = input
  const provider = entry.provider ?? defaults?.provider
  const connection = connectionDefaults(entry, defaults)
  const apiKeyEnv = entry.api_key_env ?? defaults?.api_key_env
  const baseUrl = entry.base_url ?? connection?.base_url

  if (provider === undefined) {
    throw new OperatorConfigError(
      `model ${entry.model}: provider is required (on the entry or in [model_defaults])`,
      { key: 'errors.configModelProvider', params: { model: entry.model } },
      { path: [...path, 'provider'] }
    )
  }

  const envKey = apiKeyEnv === undefined ? undefined : process.env[apiKeyEnv]
  const apiKey = envKey === '' ? undefined : envKey
  const missingEnv =
    apiKey === undefined ? missingEnvOf(input, `model ${provider}/${entry.model}`) : undefined

  const selector = entry.alias ?? `${provider}${MODEL_SELECTOR_SEPARATOR}${entry.model}`
  const out: MutableModel = {
    selector,
    provider,
    model: entry.model,
    reasoningMode: 'default',
  }

  if (baseUrl !== undefined) {
    out.baseUrl = baseUrl
  }

  if (apiKeyEnv !== undefined) {
    out.apiKeyEnv = apiKeyEnv
  }

  if (missingEnv !== undefined) {
    out.missingEnv = missingEnv
  }

  if (apiKey !== undefined) {
    out.apiKey = apiKey
  }

  if (entry.reasoning_required === true) {
    out.reasoningRequired = true
  }

  applyTuning(out, entry, defaults)

  const prices = resolveModelPrices(entry, path)

  if (prices !== undefined) {
    out.prices = prices
  }

  return out
}

/** The key variable an entry names but the environment leaves unset: thrown, or kept on the entry
 *  when the resolve defers it. */
function missingEnvOf(input: ResolveModelInput, owner: string): string | undefined {
  const { entry, defaults, path } = input
  const apiKeyEnv = entry.api_key_env ?? defaults?.api_key_env
  // A key borrowed from another provider's defaults is never required here: a local server needs
  // none. A deferred resolve keeps it, and the client asks whether that provider needs it.
  const borrowed =
    entry.api_key_env === undefined && connectionDefaults(entry, defaults) === undefined

  if (apiKeyEnv === undefined || input.apiKeyOptional === true) {
    return undefined
  }

  if (input.deferMissingKey === true) {
    return apiKeyEnv
  }

  if (borrowed) {
    return undefined
  }

  throw new MissingEnvError(apiKeyEnv, owner, { path: [...path, 'api_key_env'], effect: 'model' })
}

/** The address and router preferences in `[model_defaults]` belong to its provider, so an entry
 *  naming another one leaves them behind. */
function connectionDefaults(
  entry: RawModel,
  defaults: RawModelDefaults | undefined
): RawModelDefaults | undefined {
  return entry.provider === undefined || entry.provider === defaults?.provider
    ? defaults
    : undefined
}

function applyTuning(
  out: MutableModel,
  entry: RawModel,
  defaults: RawModelDefaults | undefined
): void {
  const reasoningMode = entry.reasoning ?? defaults?.reasoning ?? 'default'
  const maxTokens = entry.max_tokens ?? defaults?.max_tokens
  const providerRouting = resolveProviderRouting(entry, connectionDefaults(entry, defaults))
  const ttftTimeoutMs = entry.ttft_timeout_ms ?? defaults?.ttft_timeout_ms
  const streamIdleTimeoutMs = entry.stream_idle_timeout_ms ?? defaults?.stream_idle_timeout_ms

  out.reasoningMode = reasoningMode

  if (maxTokens !== undefined) {
    out.maxTokens = maxTokens
  }

  if (providerRouting !== undefined) {
    out.providerRouting = providerRouting
  }

  if (ttftTimeoutMs !== undefined) {
    out.ttftTimeoutMs = ttftTimeoutMs
  }

  if (streamIdleTimeoutMs !== undefined) {
    out.streamIdleTimeoutMs = streamIdleTimeoutMs
  }
}

/** Each key falls back to `[model_defaults]` on its own. Absent when nothing is set, so the
 *  request carries no `provider` object and the router keeps its own pick. */
function resolveProviderRouting(
  entry: RawModel,
  defaults: RawModelDefaults | undefined
): ProviderRouting | undefined {
  const sort = entry.provider_sort ?? defaults?.provider_sort
  const only = entry.provider_only ?? defaults?.provider_only
  const order = entry.provider_order ?? defaults?.provider_order
  const allowFallbacks = entry.provider_allow_fallbacks ?? defaults?.provider_allow_fallbacks
  const routing: ProviderRouting = {
    ...(sort === undefined ? {} : { sort }),
    ...(only === undefined ? {} : { only }),
    ...(order === undefined ? {} : { order }),
    ...(allowFallbacks === undefined ? {} : { allowFallbacks }),
  }

  return Object.keys(routing).length === 0 ? undefined : routing
}

function resolveModelPrices(
  entry: RawModel,
  path: readonly (string | number)[]
): ResolvedModelPrices | undefined {
  const hasInput = entry.cost_input_per_m !== undefined
  const hasOutput = entry.cost_output_per_m !== undefined

  if (!(hasInput || hasOutput)) {
    return undefined
  }

  if (entry.cost_input_per_m === undefined || entry.cost_output_per_m === undefined) {
    throw new OperatorConfigError(
      `model ${entry.model}: cost_input_per_m and cost_output_per_m must be set together`,
      { key: 'errors.configModelCostPair', params: { model: entry.model } },
      { path: [...path, 'cost_input_per_m'] }
    )
  }

  return {
    inPerM: entry.cost_input_per_m,
    outPerM: entry.cost_output_per_m,
    ...(entry.cost_cache_read_per_m !== undefined
      ? { cacheReadPerM: entry.cost_cache_read_per_m }
      : {}),
    ...(entry.cost_cache_write_per_m !== undefined
      ? { cacheWritePerM: entry.cost_cache_write_per_m }
      : {}),
  }
}
