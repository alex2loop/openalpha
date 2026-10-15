import type { ModelPrice } from '@/ai/types'
import type { ResolvedModel } from '@/core/config/resolve'
import type { ProviderModelId } from '@/core/llm'
import type { Logger } from '@/core/logging/logger'
import { findProviderById, providerById } from '@/ai/catalog'
import { modelsdevPriceOf } from '@/ai/cost/modelsdev-prices'
import { cacheOpenRouterPrices, openRouterPriceOf } from '@/ai/cost/openrouter-prices'
import { isOpenRouterFeedDue, loadOpenRouterPrices } from '@/ai/openrouter-feed'
import { ConfigError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { NetworkPolicy } from '@/core/ssrf/network-policy'

// USD per million tokens. A vendor-qualified id resolves through its unqualified tail, so one feed
// row serves both `gemini-2.5-pro` and `google/gemini-2.5-pro`.
const OPENROUTER_PROVIDER = 'openrouter'
const OPENROUTER_FREE_MODEL = 'openrouter/free'
const OPENROUTER_FREE_SUFFIX = ':free'
const FREE_PRICE: ModelPrice = Object.freeze({ inPerM: 0, outPerM: 0 })

// Conservative (Opus-tier) so an unpriced model overcharges the caps rather than running unmetered.
export const FALLBACK_PRICE: ModelPrice = Object.freeze({ inPerM: 15, outPerM: 75 })

export type PriceSource =
  | 'override'
  | 'subscription'
  | 'openrouter'
  | 'models.dev'
  | 'local'
  | 'fallback'

export interface ModelPriceResolution {
  readonly price: ModelPrice
  readonly source: PriceSource
}

// Immutable pricing policy. `createPricing` freezes the instance and snapshots its overrides, so two
// instances never share state — a second instance cannot mutate the first's override map.
interface CacheRates {
  readonly readPerM: number
  readonly writePerM: number
}

export interface Pricing {
  priceOf(id: ProviderModelId): ModelPriceResolution
  /** Settles once the live feed has answered or failed, so a price read after it never falls back
   *  for want of a fetch still in flight. */
  ready(): Promise<void>
}

/** An absent cache rate means the catalog does not know it, not that cache traffic is free, so it
 *  falls back to the input rate. One owner keeps the ledger and the pre-flight ceiling in step. */
export function cacheRatesOf(price: ModelPrice): CacheRates {
  return {
    readPerM: price.cacheReadPerM ?? price.inPerM,
    writePerM: price.cacheWritePerM ?? price.inPerM,
  }
}

export function createPricing(
  overrides: ReadonlyMap<string, ModelPrice>,
  localProviders: ReadonlySet<string> = new Set()
): Pricing {
  const snapshot = new Map<string, ModelPrice>()

  for (const [key, price] of overrides) {
    snapshot.set(key, Object.freeze({ ...price }))
  }

  return Object.freeze({
    priceOf(id: ProviderModelId): ModelPriceResolution {
      return resolvePrice(snapshot, localProviders, id)
    },
    ready: () => Promise.resolve(),
  })
}

// Override (boot-set `${provider}/${model}`) → subscription (oauth_subscription provider, always
// free) → OpenRouter live feed → models.dev vendored snapshot → conservative fallback. The qualified
// key lets two providers sharing a model name resolve distinct prices; a loopback provider (ollama, a
// local proxy, …) bills nothing, so it never reaches a feed. A provider id absent from the catalog (a
// typo in `[[models]] provider`) degrades to "not a subscription provider" and falls through the rest
// of the chain, same as `catalogBaseUrl` below — this file's convention is to degrade, never throw.
function resolvePrice(
  overrides: ReadonlyMap<string, ModelPrice>,
  localProviders: ReadonlySet<string>,
  id: ProviderModelId
): ModelPriceResolution {
  const qualifiedKey = toQualifiedModelKey(id)
  const override = overrides.get(qualifiedKey)

  if (override) {
    return { price: override, source: 'override' }
  }

  if (findProviderById(id.provider)?.authKind === 'oauth_subscription') {
    return { price: FREE_PRICE, source: 'subscription' }
  }

  if (isOpenRouterFreeModel(id)) {
    return { price: FREE_PRICE, source: 'openrouter' }
  }

  if (localProviders.has(id.provider)) {
    return { price: FREE_PRICE, source: 'local' }
  }

  const openRouterRow = withBareTail(id.model, openRouterPriceOf)

  if (openRouterRow) {
    return { price: openRouterRow, source: 'openrouter' }
  }

  const modelsdevRow = withBareTail(id.model, modelsdevPriceOf)

  if (modelsdevRow) {
    return { price: modelsdevRow, source: 'models.dev' }
  }

  return { price: FALLBACK_PRICE, source: 'fallback' }
}

/** `billsNothing` names providers that cost nothing whatever their address, such as the MCP
 *  client's own model. */
export function createConfiguredPricing(
  models: readonly ResolvedModel[],
  logger: Logger,
  billsNothing: ReadonlySet<string> = new Set()
): Pricing {
  const overrides = new Map<string, ModelPrice>()
  const localProviders = new Set(billsNothing)

  for (const entry of models) {
    const qualifiedKey = toQualifiedModelKey(entry)

    if (entry.prices !== undefined) {
      assertCompatibleOverride(overrides, qualifiedKey, entry.prices)
      overrides.set(qualifiedKey, entry.prices)
    }

    if (isLocalProvider(entry)) {
      localProviders.add(entry.provider)
    }
  }

  const pricing = createPricing(overrides, localProviders)

  if (models.every((entry) => localProviders.has(entry.provider))) {
    return pricing
  }

  const warmed = warmOpenRouterPrices(logger).catch(() => undefined)

  warmed
    .then(() => {
      warnUnknownModels(models, pricing, logger)
    })
    .catch(() => undefined)

  return Object.freeze({
    priceOf(id: ProviderModelId): ModelPriceResolution {
      refreshOpenRouterPrices(logger)

      return pricing.priceOf(id)
    },
    ready: () => warmed,
  })
}

// A due lookup starts one refresh and still answers from the last good map.
function refreshOpenRouterPrices(logger: Logger): void {
  if (!isOpenRouterFeedDue()) {
    return
  }

  warmOpenRouterPrices(logger).catch(() => undefined)
}

// `Pricing.priceOf` must stay synchronous (the DI `Bind` factory type is sync), so the live feed is
// best-effort: a lookup before this resolves falls through to models.dev/fallback for that call
// only. One shared single-flight fetch per process.
function warmOpenRouterPrices(logger: Logger): Promise<void> {
  return loadOpenRouterPrices(logger).then(cacheOpenRouterPrices, (err: unknown) => {
    logger.warn('pricing.feed_warm_failed', { err: formatErrForLog(err) })
  })
}

// Deferred until the feed has landed — warning earlier would name models OpenRouter does price.
// Asking `priceOf` rather than re-testing each feed keeps the warning on the same precedence the
// charges use; a local provider is unpriced by design, not unknown.
function warnUnknownModels(
  models: readonly ResolvedModel[],
  pricing: Pricing,
  logger: Logger
): void {
  const warned = new Set<string>()

  for (const entry of models) {
    const qualifiedKey = toQualifiedModelKey(entry)

    if (warned.has(qualifiedKey)) {
      continue
    }

    if (pricing.priceOf(entry).source !== 'fallback') {
      continue
    }

    warned.add(qualifiedKey)
    logger.warn('pricing.unknown_model', {
      provider: entry.provider,
      model: entry.model,
      fallback: FALLBACK_PRICE,
    })
  }
}

function assertCompatibleOverride(
  overrides: ReadonlyMap<string, ModelPrice>,
  key: string,
  next: ModelPrice
): void {
  const current = overrides.get(key)

  if (current !== undefined && !isSamePrice(current, next)) {
    throw new ConfigError(`conflicting price overrides for ${key}`)
  }
}

function isSamePrice(a: ModelPrice, b: ModelPrice): boolean {
  return (
    a.inPerM === b.inPerM &&
    a.outPerM === b.outPerM &&
    a.cacheReadPerM === b.cacheReadPerM &&
    a.cacheWritePerM === b.cacheWritePerM
  )
}

// A model's own `base_url` wins; unset falls back to its catalog default. Privacy gate: a
// loopback/local base URL (ollama, a self-hosted proxy, …) never leaks its model name to a public
// pricing feed — override or fallback pricing only.
function isLocalProvider(entry: ResolvedModel): boolean {
  const baseUrl = entry.baseUrl ?? catalogBaseUrl(entry.provider)
  return baseUrl !== undefined && NetworkPolicy.isLoopbackUrl(baseUrl)
}

// An entry whose provider id isn't in the catalog (should not happen post config-resolve) is
// treated as not-local — pricing still falls through to fallback, just without the privacy gate.
function catalogBaseUrl(providerId: string): string | undefined {
  try {
    return providerById(providerId).baseUrl
  } catch {
    return undefined
  }
}

// Exact id first, so a deliberately vendor-specific row still wins over its bare-name sibling.
function withBareTail(
  model: string,
  lookup: (model: string) => ModelPrice | undefined
): ModelPrice | undefined {
  const separator = model.lastIndexOf('/')

  return lookup(model) ?? (separator === -1 ? undefined : lookup(model.slice(separator + 1)))
}

function isOpenRouterFreeModel(id: ProviderModelId): boolean {
  return (
    id.provider === OPENROUTER_PROVIDER &&
    (id.model === OPENROUTER_FREE_MODEL || id.model.endsWith(OPENROUTER_FREE_SUFFIX))
  )
}

function toQualifiedModelKey(id: ProviderModelId): string {
  return `${id.provider}/${id.model}`
}
