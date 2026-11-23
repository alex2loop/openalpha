import type { ConfigHost } from '@/core/config/paths'
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
  /** The `[model_defaults]` provider the key variable came from, when the entry names another one;
   *  the client keeps the key only for a provider of the same vendor. */
  readonly apiKeyLender?: string
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
  readonly env: ConfigHost['env']
  /** An unset key env var is not a config error; the chain registry skips a tier that needs it. */
  readonly apiKeyOptional?: true
  /** An unset key env var is recorded on the entry rather than thrown. */
  readonly deferMissingKey?: true
}

export function resolveModel(input: ResolveModelInput): ResolvedModel {
  const { entry, defaults, path } = input
  const provider = entry.provider ?? defaults?.provider
  const connection = connectionDefaults(entry, defaults)
  const baseUrl = entry.base_url ?? connection?.base_url

  if (provider === undefined) {
    throw new OperatorConfigError(
      `model ${entry.model}: provider is required (on the entry or in [model_defaults])`,
      { key: 'errors.configModelProvider', params: { model: entry.model } },
      { path: [...path, 'provider'] }
    )
  }

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

  applyKey(out, input)

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

/** The key variable and what it holds, or the unset variable when the resolve defers it. */
function applyKey(out: MutableModel, input: ResolveModelInput): void {
  const { entry, defaults } = input
  const apiKeyEnv = entry.api_key_env ?? defaults?.api_key_env

  if (apiKeyEnv === undefined) {
    return
  }

  const apiKey = input.env[apiKeyEnv]

  out.apiKeyEnv = apiKeyEnv

  const lender = keyLenderOf(entry, defaults)

  if (lender !== undefined) {
    out.apiKeyLender = lender
  }

  if (apiKey === undefined || apiKey === '') {
    const missingEnv = missingEnvOf(input, apiKeyEnv, `model ${out.provider}/${out.model}`)

    if (missingEnv !== undefined) {
      out.missingEnv = missingEnv
    }

    return
  }

  out.apiKey = apiKey
}

/** The key variable an entry names but the environment leaves unset: thrown, or kept on the entry
 *  when the resolve defers it. */
function missingEnvOf(
  input: ResolveModelInput,
  apiKeyEnv: string,
  owner: string
): string | undefined {
  if (input.apiKeyOptional === true) {
    return undefined
  }

  if (input.deferMissingKey === true) {
    return apiKeyEnv
  }

  // An inherited key is never required here: a server on this machine needs none, and the client
  // asks whether the entry's provider does.
  if (isInheritedKey(input.entry, input.defaults)) {
    return undefined
  }

  throw new MissingEnvError(apiKeyEnv, owner, {
    path: [...input.path, 'api_key_env'],
    effect: 'model',
  })
}

/** The `[model_defaults]` provider whose key an entry inherits; none when the defaults name no
 *  provider, whose key is then every entry's. */
function keyLenderOf(entry: RawModel, defaults: RawModelDefaults | undefined): string | undefined {
  return isInheritedKey(entry, defaults) ? defaults?.provider : undefined
}

/** The entry names no key of its own and a provider other than the one the defaults name. */
function isInheritedKey(entry: RawModel, defaults: RawModelDefaults | undefined): boolean {
  return (
    entry.api_key_env === undefined &&
    entry.provider !== undefined &&
    defaults?.provider !== undefined &&
    entry.provider !== defaults.provider
  )
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
