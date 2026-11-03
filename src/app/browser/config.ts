import { z } from 'zod'

import type { ResolvedConfig } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import { findProviderById } from '@/ai/api'
import { BROWSER_AI_PROVIDERS, listKeyVariables, readSearchSelection } from '@/app/browser/keys'
import { parseRawConfig, resolveConfig } from '@/core/config/resolve'
import { freezeDeep } from '@/core/utils/freeze'

/** The tiers a visitor may change. The rest keep their shipped chain: the page never offers them. */
const EDITABLE_TIERS = Object.freeze([
  'debate',
  'research',
  'research-heavy',
  'extraction',
] as const)

/** Where the engine keeps what it writes. There is no disk: the name is a stable label that the
 *  few paths derived from it share. */
const DATA_DIR = '/data'
const HOME_DIR = '/'
const MAX_CHAIN_ENTRIES = 3
const MAX_MODEL_CHARS = 200
/** Stands in for a key in the environment the config resolves against, so every model that needs a
 *  key builds its chain; the real key is read from the keyring on each request. */
const KEY_PLACEHOLDER = 'browser-managed-key'

const TierEntrySchema = z.strictObject({
  provider: z.enum(BROWSER_AI_PROVIDERS),
  model: z.string().trim().min(1).max(MAX_MODEL_CHARS),
})

const TierChainSchema = z.array(TierEntrySchema).min(1).max(MAX_CHAIN_ENTRIES)

/** What the visitor changed: a chain of provider and model per editable tier, nothing else. */
export const TierOverridesSchema = z.strictObject({
  debate: TierChainSchema.optional(),
  research: TierChainSchema.optional(),
  'research-heavy': TierChainSchema.optional(),
  extraction: TierChainSchema.optional(),
})

export type TierOverrides = z.infer<typeof TierOverridesSchema>
type TierEntry = z.infer<typeof TierEntrySchema>

/** The shipped starting point: the installed version's minimal config, on OpenRouter. Its models,
 *  daily cap and tiers are kept in step with `config.minimal.toml` by hand. */
const SHIPPED_PROVIDER = 'openrouter'
const SHIPPED_PRIMARY_MODEL = 'deepseek/deepseek-v4.1-flash'
const SHIPPED_MODEL = 'anthropic/claude-haiku-5.5'
const DAILY_SPEND_CAP_USD = 2

/** What the editable tiers hold until the visitor changes them. */
export const SHIPPED_TIERS: Required<TierOverrides> = freezeDeep({
  debate: [{ provider: SHIPPED_PROVIDER, model: 'openai/gpt-6-luna' }],
  research: [{ provider: SHIPPED_PROVIDER, model: SHIPPED_MODEL }],
  'research-heavy': [{ provider: SHIPPED_PROVIDER, model: SHIPPED_MODEL }],
  extraction: [{ provider: SHIPPED_PROVIDER, model: SHIPPED_MODEL }],
})

// The headline tier (`decisions`) is left out on purpose: its endpoint reads its key itself, which
// the keyring cannot supply, and an absent tier turns the headline read off cleanly.
const HIDDEN_TIERS = {
  themes: [{ model: SHIPPED_MODEL }],
}

export function resolveBrowserConfig(
  locale: Locale,
  overrides: TierOverrides = {}
): ResolvedConfig {
  const raw = parseRawConfig({
    locale: { language: locale },
    model_defaults: {
      provider: SHIPPED_PROVIDER,
      api_key_env: findProviderById(SHIPPED_PROVIDER)?.apiKeyEnv,
      provider_sort: 'latency',
    },
    models: [{ model: SHIPPED_PRIMARY_MODEL }],
    model_tiers: { ...HIDDEN_TIERS, ...toRawTiers({ ...SHIPPED_TIERS, ...overrides }) },
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
