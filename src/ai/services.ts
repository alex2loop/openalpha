import type { ProviderChainRegistry } from '@/ai/chain/registry'
import type { Pricing } from '@/ai/cost/pricing'
import type { ResolvedConfig, ResolvedModel } from '@/core/config/resolve'
import type { Bind, ServiceProvider } from '@/core/container'
import { createCredentialSources } from '@/ai/auth/credentials'
import { createProviderChainRegistry } from '@/ai/chain/registry'
import { createClientModelChain } from '@/ai/client-model/chain'
import { createConfiguredPricing } from '@/ai/cost/pricing'
import { CLIENT_MODEL_PROVIDER, isClientModelSource } from '@/core/config/resolve'

declare module '@/core/container' {
  interface Services {
    pricing: Pricing
    llmChains: ProviderChainRegistry
  }
}

// `logger` is bound by the composition root before persistence, so `ai` must register
// after it — provider order in app/providers.ts is load-bearing. `env` is the boot environment,
// where the cloud sign-ins find their credentials.
export function createAiProvider(
  env: Readonly<Record<string, string | undefined>>
): ServiceProvider {
  return {
    name: 'ai',
    register(bind: Bind): void {
      bind('pricing', (app) =>
        createConfiguredPricing(
          allConfiguredModels(app.config),
          app.resolve('logger'),
          isClientModelSource(app.config.modelSource) ? new Set([CLIENT_MODEL_PROVIDER]) : undefined
        )
      )
      // Under the client source the client's model is the primary chain; a configured tier such as
      // `decisions` still answers the direct lookups that name it.
      bind('llmChains', (app) =>
        createProviderChainRegistry({
          config: app.config,
          logger: app.resolve('logger'),
          bus: app.resolve('bus'),
          pricing: app.resolve('pricing'),
          credentials: createCredentialSources({
            dataDir: app.config.paths.dataDir,
            logger: app.resolve('logger'),
            env,
          }),
          ...(isClientModelSource(app.config.modelSource)
            ? { primary: createClientModelChain(app.resolve('clientModelBroker')) }
            : {}),
        })
      )
    },
  }
}

function allConfiguredModels(config: ResolvedConfig): readonly ResolvedModel[] {
  return [...config.models, ...Object.values(config.modelTiers).flat()]
}
