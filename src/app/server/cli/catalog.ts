import type { CatalogModel, ProviderEntry } from '@/ai/api'
import type { ProviderCatalogResponse } from '@/app/server/wire/config'
import { CATALOG_MODELS, PROVIDERS } from '@/ai/api'

/** The provider catalog as the wire carries it: `GET /v1/providers` and `setup catalog` both answer
 *  with this, so the app reads one shape before and after the daemon is running. */
export function buildProviderCatalog(): ProviderCatalogResponse {
  // The catalog is a literal registry (`as const satisfies`); widen it before mapping so optional
  // fields exist on every element.
  const catalog: readonly ProviderEntry[] = PROVIDERS
  const rawCatalogModels: readonly CatalogModel[] = CATALOG_MODELS
  const providers = catalog.map((entry) => ({
    id: entry.id,
    displayName: entry.displayName,
    envVar: entry.apiKeyEnv,
    baseUrl: entry.baseUrl,
    transport: entry.transport,
    auth: entry.authStyle,
    ...(entry.defaultModel === undefined ? {} : { defaultModel: entry.defaultModel }),
  }))
  const catalogModels = rawCatalogModels.map((entry) => ({
    name: entry.name,
    provider: entry.provider,
    model: entry.model,
  }))

  return { providers, catalogModels }
}
