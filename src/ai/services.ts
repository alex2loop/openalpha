import type { CredentialSource } from '@/ai/auth/types'
import type { ProviderChainRegistry } from '@/ai/chain/registry'
import type { Pricing } from '@/ai/cost/pricing'
import type { ResolvedConfig, ResolvedModel } from '@/core/config/resolve'
import type { App, Bind, ServiceProvider } from '@/core/container'
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
// after it — provider order in app/providers.ts is load-bearing. The host owns how a model call is
// signed in: the daemon reads token files and cloud identities, the browser holds none.
export function createAiProvider(
  credentialSources: (app: App) => readonly CredentialSource[]
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
      bind('llmChains', (app) => {
        const pricing = app.resolve('pricing')

        // Everything that can call a model builds this chain, so the feed still warms in parallel
        // with boot there, while a model-free command never pays for it.
        pricing.ready().catch(() => undefined)

        return createProviderChainRegistry({
          config: app.config,
          logger: app.resolve('logger'),
          bus: app.resolve('bus'),
          pricing,
          credentials: credentialSources(app),
          ...(isClientModelSource(app.config.modelSource)
            ? { primary: createClientModelChain(app.resolve('clientModelBroker')) }
            : {}),
        })
      })
    },
  }
}

function allConfiguredModels(config: ResolvedConfig): readonly ResolvedModel[] {
  return [...config.models, ...Object.values(config.modelTiers).flat()]
}
