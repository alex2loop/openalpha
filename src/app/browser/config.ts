import { z } from 'zod'

import type { ResolvedConfig } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import { findProviderById } from '@/ai/api'
import { type CustomVenues, toRawVenues } from '@/app/browser/custom-venues'
import { BROWSER_AI_PROVIDERS, listKeyVariables, readSearchSelection } from '@/app/browser/keys'
import { parseRawConfig, resolveConfig } from '@/core/config/resolve'
import { freezeDeep } from '@/core/utils/freeze'

/** The tiers a visitor may override. The rest keep their shipped chain: the page never offers them. */
const EDITABLE_TIERS = Object.freeze(['debate', 'research', 'research-heavy'] as const)

/** Where the engine keeps what it writes. There is no disk: the name is a stable label that the
 *  few paths derived from it share. */
const DATA_DIR = '/data'
const HOME_DIR = '/'
const MAX_CHAIN_ENTRIES = 3
const MAX_MODEL_CHARS = 200
/** Stands in for a key in the environment the config resolves against, so every model that needs a
 *  key builds its chain; the real key is read from the keyring on each request. */
const KEY_PLACEHOLDER = 'browser-managed-key'

/** The shipped starting point, on OpenRouter. The main model is the one `/suggest` argues on. */
const SHIPPED_PROVIDER = 'openrouter'
const SHIPPED_MAIN_MODEL = 'openai/gpt-6-luna'
/** The web's own cap, above the installed version's: a visitor's key pays for each run. */
const DAILY_SPEND_CAP_USD = 5

const TierEntrySchema = z.strictObject({
  provider: z.enum(BROWSER_AI_PROVIDERS),
  model: z.string().trim().min(1).max(MAX_MODEL_CHARS),
})

/** An ordered chain of provider and model: the first is tried first, the rest are fallbacks. */
export const ModelChainSchema = z.array(TierEntrySchema).min(1).max(MAX_CHAIN_ENTRIES)

/** The tiers the visitor gave a chain of their own; a tier left out uses the main model. */
export const TierOverridesSchema = z.strictObject({
  debate: ModelChainSchema.optional(),
  research: ModelChainSchema.optional(),
  'research-heavy': ModelChainSchema.optional(),
})

type ModelChain = z.infer<typeof ModelChainSchema>
type TierOverrides = z.infer<typeof TierOverridesSchema>
type TierEntry = z.infer<typeof TierEntrySchema>

/** Everything the visitor changed of the shipped config. */
export interface BrowserOverrides {
  readonly models: ModelChain
  readonly tiers: TierOverrides
  readonly venues: CustomVenues
}

/** The main model until the visitor changes it. */
export const SHIPPED_MODELS: ModelChain = freezeDeep([
  { provider: SHIPPED_PROVIDER, model: SHIPPED_MAIN_MODEL },
])

export function resolveBrowserConfig(locale: Locale, overrides: BrowserOverrides): ResolvedConfig {
  const raw = parseRawConfig({
    locale: { language: locale },
    model_defaults: {
      provider: SHIPPED_PROVIDER,
      api_key_env: findProviderById(SHIPPED_PROVIDER)?.apiKeyEnv,
      provider_sort: 'latency',
    },
    models: overrides.models.map(toRawModel),
    model_tiers: toRawTiers(overrides.tiers),
    ...(overrides.venues.length === 0
      ? {}
      : { trading: { venues: toRawVenues(overrides.venues) } }),
    budget: { max_daily_usd: DAILY_SPEND_CAP_USD },
    api: { enabled: false, orders: false },
  })

  return resolveConfig(raw, {
    env: Object.fromEntries(listKeyVariables().map((name) => [name, KEY_PLACEHOLDER])),
    homeDir: HOME_DIR,
    dataDir: DATA_DIR,
  })
}

/** The search section for the keys held now: the provider whose key is set, with that key. Config
 *  is frozen at start, so this is read again whenever the keys change. */
export function resolveBrowserSearch(
  env: Readonly<Record<string, string | undefined>>
): ResolvedConfig['webSearch'] {
  const selected = readSearchSelection(env)
  // No fallback is named: the resolver refuses one equal to the provider, and a research search
  // that comes back empty is then reported empty instead of reaching a backend the page's
  // connect-src does not allow.
  const raw = parseRawConfig({
    models: [],
    ...(selected === undefined
      ? {}
      : { web_search: { provider: selected.provider, api_key_env: selected.variable } }),
  })

  return resolveConfig(raw, { env, homeDir: HOME_DIR, dataDir: DATA_DIR }).webSearch
}

function toRawTiers(overrides: TierOverrides): Record<string, readonly object[]> {
  const tiers: Record<string, readonly object[]> = {}

  for (const tier of EDITABLE_TIERS) {
    const chain = overrides[tier]

    if (chain !== undefined) {
      tiers[tier] = chain.map(toRawModel)
    }
  }

  return tiers
}

function toRawModel(entry: TierEntry): object {
  return {
    provider: entry.provider,
    model: entry.model,
    api_key_env: findProviderById(entry.provider)?.apiKeyEnv,
  }
}
