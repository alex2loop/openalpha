import type { CredentialSource } from '@/ai/auth/types'
import type { Pricing } from '@/ai/cost/pricing'
import type { ResolvedConfig, ResolvedModel } from '@/core/config/resolve'
import type { EventBus } from '@/core/events'
import type { ProviderChain } from '@/core/llm'
import type { Logger } from '@/core/logging/logger'
import { createClient } from '@/ai/client'
import { ConfigError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'

export interface ProviderChainRegistry {
  readonly primary: ProviderChain
  findTier(name: string): ProviderChain | undefined
  resolveTier(name: string): ProviderChain
}

interface ProviderChainRegistryInput {
  readonly config: ResolvedConfig
  readonly logger: Logger
  readonly bus: EventBus
  readonly pricing: Pricing
  readonly credentials?: readonly CredentialSource[]
  /** Replaces the `[[models]]` chain. Tiers are then optional extras, built on first lookup: one
   *  that cannot be built - a key the host did not pass on, say - is reported absent with a
   *  warning instead of failing boot, and a tier nothing looks up is never built. */
  readonly primary?: ProviderChain
}

interface TierCache {
  readonly input: ProviderChainRegistryInput
  readonly built: Map<string, ProviderChain | undefined>
}

function createConfiguredChain(
  input: ProviderChainRegistryInput,
  models: readonly ResolvedModel[],
  configPath: readonly (string | number)[]
): ProviderChain {
  return createClient({
    models,
    tuning: input.config.llm,
    logger: input.logger,
    bus: input.bus,
    pricing: input.pricing,
    configPath,
    ...(input.credentials === undefined ? {} : { credentials: input.credentials }),
  })
}

export function createProviderChainRegistry(
  input: ProviderChainRegistryInput
): ProviderChainRegistry {
  const primary = input.primary ?? createConfiguredChain(input, input.config.models, ['models'])
  const tiers: TierCache = { input, built: new Map() }

  if (input.primary === undefined) {
    for (const name of Object.keys(input.config.modelTiers)) {
      tierChain(tiers, name)
    }
  }

  return Object.freeze({
    primary,
    findTier: (name: string): ProviderChain | undefined => tierChain(tiers, name),
    resolveTier(name: string): ProviderChain {
      const chain = tierChain(tiers, name)

      if (chain === undefined) {
        throw unknownModelTierError(name)
      }

      return chain
    },
  })
}

/** Built once per name, an absent or skipped tier included, so a failure warns once. */
function tierChain(tiers: TierCache, name: string): ProviderChain | undefined {
  if (!tiers.built.has(name)) {
    tiers.built.set(name, createTierChain(tiers.input, name))
  }

  return tiers.built.get(name)
}

function createTierChain(
  input: ProviderChainRegistryInput,
  name: string
): ProviderChain | undefined {
  const models = input.config.modelTiers[name]

  if (models === undefined) {
    return undefined
  }

  try {
    return createConfiguredChain(input, models, ['model_tiers', name])
  } catch (err: unknown) {
    if (input.primary === undefined || !(err instanceof ConfigError)) {
      throw err
    }

    input.logger.warn('llm.tier_skipped', { tier: name, err: formatErrForLog(err) })
    return undefined
  }
}

function unknownModelTierError(name: string): ConfigError {
  return new ConfigError(`unknown model tier: ${name}`, undefined, ['model_tiers', name])
}
