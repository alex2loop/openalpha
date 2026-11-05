import { z } from 'zod'

import type { ModelEntryWire, ModelPricesResponse, ModelsResponse } from '@/app/server/wire/models'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { App } from '@/core/container'
import type { ProviderModelId } from '@/core/llm'
import {
  findProviderById,
  loadOpenRouterToolSupport,
  OPENROUTER_PROVIDER,
  type Pricing,
} from '@/ai/api'
import { apiError, json } from '@/app/server/http/dispatch'
import { COST_ESTIMATE_SAMPLE } from '@/app/server/wire/system'

const MAX_PRICED_MODELS = 50
const MAX_NAME_CHARS = 200
const NO_TOOL_SUPPORT: ReadonlyMap<string, boolean> = new Map()

const PriceQuerySchema = z.object({
  provider: z.string().min(1).max(MAX_NAME_CHARS),
  models: z.array(z.string().min(1).max(MAX_NAME_CHARS)).min(1).max(MAX_PRICED_MODELS),
})

/** What the entries of one answer are read from. `toolSupport` is the feed's word on whether each
 *  OpenRouter model takes tools; it has no entry for a model the feed does not describe, and is
 *  empty when the feed did not answer. */
interface EntryContext {
  readonly pricing: Pricing
  readonly perRun: ReadonlyMap<string, number>
  readonly toolSupport: ReadonlyMap<string, boolean>
}

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
  const entries = Object.entries(app.config.modelTiers)
  const context = await readEntryContext(
    app,
    entries.flatMap(([, tier]) => tier)
  )

  return entries.map(([tier, models]) => ({
    tier,
    models: models.map((entry) => toModelEntry(entry, context)),
  }))
}

/** The same entries for models the page names, configured or not: what it shows beside a model
 *  before the visitor picks it. */
async function handleModelPrices(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const query = readPriceQuery(new URL(req.url).searchParams)

  if (query === undefined) {
    return apiError('invalid_body')
  }

  const ids = query.models.map((model) => ({ provider: query.provider, model }))
  const context = await readEntryContext(ctx.app, ids)

  return json({
    models: ids.map((id) => toModelEntry(id, context)),
  } satisfies ModelPricesResponse)
}

function readPriceQuery(params: URLSearchParams): z.infer<typeof PriceQuerySchema> | undefined {
  const parsed = PriceQuerySchema.safeParse({
    provider: params.get('provider'),
    models: parseJsonText(params.get('models')),
  })

  return parsed.success ? parsed.data : undefined
}

function parseJsonText(text: string | null): unknown {
  if (text === null) {
    return undefined
  }

  try {
    return JSON.parse(text)
  } catch {
    // Not JSON: it fails the schema like any other value that is not a list of names.
    return undefined
  }
}

async function readEntryContext(app: App, ids: readonly ProviderModelId[]): Promise<EntryContext> {
  const pricing = app.resolve('pricing')
  const models = [...new Set(ids.map(({ model }) => model))]

  // A price read before the live feed answers would be the fallback for a model the feed lists.
  await pricing.ready()

  const [costs, toolSupport] = await Promise.all([
    app.resolve('llmAttemptStore').perRunCostByModel(models, COST_ESTIMATE_SAMPLE, Date.now()),
    ids.some(({ provider }) => provider === OPENROUTER_PROVIDER)
      ? loadOpenRouterToolSupport(app.resolve('logger'))
      : NO_TOOL_SUPPORT,
  ])

  return {
    pricing,
    perRun: new Map(costs.map((cost) => [`${cost.provider}|${cost.model}`, cost.perRunUsd])),
    toolSupport,
  }
}

function toModelEntry(id: ProviderModelId, context: EntryContext): ModelEntryWire {
  const { price, source } = context.pricing.priceOf(id)
  const perRunUsd = context.perRun.get(`${id.provider}|${id.model}`)

  return {
    provider: id.provider,
    model: id.model,
    supportsTools: canCallTools(id, context.toolSupport),
    price: { ...price, source },
    ...(perRunUsd === undefined ? {} : { perRunUsd }),
  }
}

// OpenRouter's feed says per model whether its endpoints take tools; a model the feed does not
// describe, any other provider and a feed that did not answer read as the catalog entry declares.
function canCallTools(
  { provider, model }: ProviderModelId,
  toolSupport: ReadonlyMap<string, boolean>
): boolean {
  const listed = provider === OPENROUTER_PROVIDER ? toolSupport.get(model) : undefined

  return listed ?? findProviderById(provider)?.supportsTools === true
}

export const MODEL_PRICES_ROUTE = {
  method: 'GET',
  path: '/v1/models/prices',
  auth: true,
  handler: handleModelPrices,
} as const satisfies ApiRouteSpec

export const MODEL_ROUTES = [
  { method: 'GET', path: '/v1/models', auth: true, handler: handleModels },
  MODEL_PRICES_ROUTE,
] as const satisfies readonly ApiRouteSpec[]
