import type { CredentialSource } from '@/ai/auth/types'
import type { ProviderEntry } from '@/ai/catalog'
import type { Pricing } from '@/ai/cost/pricing'
import type { ChainEntry } from '@/ai/types'
import type { KeyEffect, ResolvedConfig, ResolvedLlm, ResolvedModel } from '@/core/config/resolve'
import type { EventBus } from '@/core/events'
import type { ProviderChain } from '@/core/llm'
import type { Logger } from '@/core/logging/logger'
import { IDENTITY_ENV } from '@/ai/auth/cloud/identity'
import { buildUnknownProviderMessage, findProviderById, requiresApiKey } from '@/ai/catalog'
import { createProviderChain } from '@/ai/chain/provider-chain'
import { createConfiguredPricing } from '@/ai/cost/pricing'
import { resolveReasoning } from '@/ai/reasoning/resolve'
import { MissingEnvError, OperatorConfigError } from '@/core/config/resolve'
import { DEFAULT_MAX_TOKENS } from '@/core/stream-events'

const MODELS_SECTION = 'models'
const TIERS_SECTION = 'model_tiers'

export interface CreateClientInput {
  readonly models: readonly ResolvedModel[]
  readonly tuning: ResolvedLlm
  readonly logger: Logger
  readonly bus?: EventBus
  readonly pricing?: Pricing
  readonly configPath: readonly (string | number)[]
  readonly credentials?: readonly CredentialSource[]
}

export function createClient(input: CreateClientInput): ProviderChain {
  if (input.models.length === 0) {
    throw new OperatorConfigError(
      'model chain must contain at least one entry',
      { key: 'errors.configModelChainEmpty' },
      { path: input.configPath }
    )
  }

  // An entry whose key is unset steps aside; with none left, every call names the variable to set.
  const keyed = input.models.filter((model) => !isUnkeyed(model))
  const [first] = input.models

  if (keyed.length === 0 && first !== undefined && isUnkeyed(first)) {
    return createUnkeyedChain(toMissingKeyError(first, input.configPath, 'model'))
  }

  const pricing = input.pricing ?? createConfiguredPricing(keyed, input.logger)
  const credentials = input.credentials ?? []
  const entries = keyed.map((model) =>
    toChainEntry({ model, logger: input.logger, configPath: input.configPath, credentials })
  )

  return createProviderChain({
    entries,
    logger: input.logger,
    pricing,
    tuning: input.tuning,
    ...(input.bus === undefined ? {} : { bus: input.bus }),
  })
}

type UnkeyedModel = ResolvedModel & { readonly missingEnv: string }

/** One error per unset key variable, for the configured chain and tier entries whose provider
 *  cannot answer without it: what a deferred resolve leaves for the caller to report. A key is a
 *  fallback's while every chain missing it still has a keyed entry to answer. */
export function missingKeyErrors(
  config: Pick<ResolvedConfig, 'models' | 'modelTiers'>
): readonly MissingEnvError[] {
  const byEnv = new Map<string, MissingEnvError>()
  const chains = [
    { models: config.models, path: [MODELS_SECTION] },
    ...Object.entries(config.modelTiers).map(([tier, models]) => ({
      models,
      path: [TIERS_SECTION, tier],
    })),
  ]

  for (const chain of chains) {
    const answers = chain.models.some((model) => !isUnkeyed(model))
    const effect: KeyEffect = answers ? 'fallback' : 'model'

    for (const [index, model] of chain.models.entries()) {
      if (isUnkeyed(model) && byEnv.get(model.missingEnv)?.effect !== 'model') {
        byEnv.set(model.missingEnv, toMissingKeyError(model, [...chain.path, index], effect))
      }
    }
  }

  return [...byEnv.values()]
}

/** A key borrowed from another provider's defaults is reported unset as well; it only takes the
 *  entry out of the chain where the provider cannot answer without one. An unknown provider stays
 *  in, for `toChainEntry` to refuse by name. */
function isUnkeyed(model: ResolvedModel): model is UnkeyedModel {
  if (model.missingEnv === undefined) {
    return false
  }

  const provider = findProviderById(model.provider)

  return provider !== undefined && requiresApiKey(provider, model.baseUrl ?? provider.baseUrl)
}

function toMissingKeyError(
  model: UnkeyedModel,
  configPath: readonly (string | number)[],
  effect: KeyEffect
): MissingEnvError {
  return new MissingEnvError(model.missingEnv, `model ${model.provider}/${model.model}`, {
    path: [...configPath, 'api_key_env'],
    effect,
  })
}

interface ChainEntryInput {
  readonly model: ResolvedModel
  readonly logger: Logger
  readonly configPath: readonly (string | number)[]
  readonly credentials: readonly CredentialSource[]
}

interface AssertEntryInput {
  readonly model: ResolvedModel
  readonly provider: ProviderEntry
  readonly credentials: CredentialSource | undefined
  readonly configPath: readonly (string | number)[]
  readonly baseUrl: string
}

function assertChainEntry(input: AssertEntryInput): void {
  const { model, provider, configPath } = input

  assertSignIn(input)

  if (provider.authKind === 'oauth_subscription' && model.prices !== undefined) {
    throw new OperatorConfigError(
      `model ${model.provider}/${model.model}: subscription usage is free — remove cost_input_per_m and cost_output_per_m`,
      {
        key: 'errors.configModelSubscriptionCost',
        params: { model: `${model.provider}/${model.model}` },
      },
      { path: [...configPath, 'cost_input_per_m'] }
    )
  }

  if (!provider.supportsMaxTokens && model.maxTokens !== undefined) {
    throw new OperatorConfigError(
      `model ${model.provider}/${model.model}: this provider rejects an output cap — remove max_tokens (from the entry or [model_defaults])`,
      {
        key: 'errors.configModelNoMaxTokens',
        params: { model: `${model.provider}/${model.model}` },
      },
      { path: [...configPath, 'max_tokens'] }
    )
  }
}

function assertSignIn(input: AssertEntryInput): void {
  const { model, provider, credentials, configPath, baseUrl } = input
  const name = `${model.provider}/${model.model}`

  // Matching credentials by `provider.id` (never by "is a subscription provider") is what stops a
  // second, unregistered login provider from silently receiving another vendor's tokens.
  if (provider.authKind === 'oauth_subscription' && credentials === undefined) {
    throw new OperatorConfigError(
      `model ${name}: no login is registered for this provider`,
      { key: 'errors.configModelNoLogin', params: { model: name } },
      { path: [...configPath, 'provider'] }
    )
  }

  if (provider.identity !== undefined && model.apiKey === undefined && credentials === undefined) {
    const env = IDENTITY_ENV[provider.identity].join(', ')

    throw new OperatorConfigError(
      `model ${name}: no api_key_env and no ${env} to sign in with`,
      { key: 'errors.configModelNoSignIn', params: { model: name, env } },
      { path: [...configPath, 'api_key_env'] }
    )
  }

  if (model.apiKey === undefined && requiresApiKey(provider, baseUrl)) {
    throw new OperatorConfigError(
      `model ${name}: api_key_env is required (on the entry or in [model_defaults])`,
      { key: 'errors.configModelKeyEnvMissing', params: { model: name } },
      { path: [...configPath, 'api_key_env'] }
    )
  }
}

function catalogProvider(
  model: ResolvedModel,
  configPath: readonly (string | number)[]
): ProviderEntry {
  const provider = findProviderById(model.provider)

  if (provider === undefined) {
    throw new OperatorConfigError(
      `model ${model.provider}/${model.model}: unknown provider`,
      buildUnknownProviderMessage(model),
      { path: [...configPath, 'provider'] }
    )
  }

  return provider
}

function toChainEntry(input: ChainEntryInput): ChainEntry {
  const { model, logger, configPath } = input
  const provider = catalogProvider(model, configPath)
  const baseUrl = model.baseUrl ?? provider.baseUrl

  if (baseUrl === '') {
    throw new OperatorConfigError(
      `model ${model.provider}/${model.model}: provider has no default endpoint — set [[models]] base_url`,
      {
        key: 'errors.configModelBaseUrlMissing',
        params: { model: `${model.provider}/${model.model}` },
      },
      { path: [...configPath, 'base_url'] }
    )
  }

  // At request time `new URL` throws a raw TypeError, which is not an LLMError and so escapes the
  // chain's fallback classification entirely.
  if (!URL.canParse(baseUrl)) {
    throw new OperatorConfigError(
      `model ${model.provider}/${model.model}: base_url '${baseUrl}' is not a valid URL`,
      {
        key: 'errors.configModelBaseUrlInvalid',
        params: { model: `${model.provider}/${model.model}`, url: baseUrl },
      },
      { path: [...configPath, 'base_url'] }
    )
  }

  // A key the operator set wins over a cloud sign-in for the same provider.
  const credentials =
    provider.identity !== undefined && model.apiKey !== undefined
      ? undefined
      : input.credentials.find((source) => source.provider === provider.id)

  assertChainEntry({ model, provider, credentials, configPath, baseUrl })

  return {
    provider,
    model: model.model,
    apiKey: model.apiKey ?? '',
    ...(credentials === undefined ? {} : { credentials }),
    baseUrl,
    logger,
    reasoningMode: model.reasoningMode,
    ...(model.reasoningRequired === undefined
      ? {}
      : { reasoningRequired: model.reasoningRequired }),
    reasoningResolution: resolveReasoning({
      model: model.model,
      requested: model.reasoningMode,
      maxTokens: model.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(provider.reasoning === undefined ? {} : { family: provider.reasoning }),
      ...(model.reasoningRequired === undefined
        ? {}
        : { reasoningRequired: model.reasoningRequired }),
    }),
    ...(model.providerRouting === undefined ? {} : { providerRouting: model.providerRouting }),
    ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
    ...(model.ttftTimeoutMs === undefined ? {} : { ttftTimeoutMs: model.ttftTimeoutMs }),
    ...(model.streamIdleTimeoutMs === undefined
      ? {}
      : { streamIdleTimeoutMs: model.streamIdleTimeoutMs }),
  }
}

function createUnkeyedChain(error: MissingEnvError): ProviderChain {
  return Object.freeze({
    stream: () => Promise.reject(error),
    estimateMaxCost: () => 0,
  })
}
