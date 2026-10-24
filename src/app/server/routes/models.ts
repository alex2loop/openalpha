import type { ModelsResponse } from '@/app/server/wire/models'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { App } from '@/core/container'
import { findProviderById } from '@/ai/api'
import { json } from '@/app/server/http/dispatch'
import { COST_ESTIMATE_SAMPLE } from '@/app/server/routes/system'

/** What the app shows of each configured model, in the order its tier tries them. The price is the
 *  one the cost ledger settles with, so the page and the caps agree. */
async function handleModels(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  const { config } = ctx.app

  if (config.modelSource === 'client') {
    return json({ modelSource: 'client', tiers: [] } satisfies ModelsResponse)
  }

  return json({
    modelSource: config.modelSource,
    tiers: await toTiers(ctx.app),
  } satisfies ModelsResponse)
}

async function toTiers(app: App): Promise<ModelsResponse['tiers']> {
  const pricing = app.resolve('pricing')
  const entries = Object.entries(app.config.modelTiers)
  const models = [...new Set(entries.flatMap(([, tier]) => tier.map((entry) => entry.model)))]
  const costs = await app.resolve('llmAttemptStore').perRunCostByModel(models, COST_ESTIMATE_SAMPLE)
  const perRun = new Map(costs.map((cost) => [`${cost.provider}|${cost.model}`, cost.perRunUsd]))

  return entries.map(([tier, tierModels]) => ({
    tier,
    models: tierModels.map((entry) => {
      const { price, source } = pricing.priceOf({ provider: entry.provider, model: entry.model })
      const perRunUsd = perRun.get(`${entry.provider}|${entry.model}`)

      return {
        provider: entry.provider,
        model: entry.model,
        supportsTools: findProviderById(entry.provider)?.supportsTools === true,
        price: { ...price, source },
        ...(perRunUsd === undefined ? {} : { perRunUsd }),
      }
    }),
  }))
}

export const MODEL_ROUTES = [
  { method: 'GET', path: '/v1/models', auth: true, handler: handleModels },
] as const satisfies readonly ApiRouteSpec[]
