import type { KeySlot, SLOT_PROVIDERS } from '@/web/edition/keys-store'

interface ProviderInfo {
  readonly name: string
  /** Where the visitor makes a key of their own. */
  readonly keyUrl: string
  /** The provider's own privacy policy, which the consent notice points to. */
  readonly policyUrl: string
}

/** Every provider a slot offers has an entry, and none the slot does not. */
type SlotTable = {
  readonly [S in KeySlot]: Readonly<Record<(typeof SLOT_PROVIDERS)[S][number], ProviderInfo>>
}

// DeepSeek serves both slots with the same name and links; each slot still holds its own key.
const DEEPSEEK: ProviderInfo = {
  name: 'DeepSeek',
  keyUrl: 'https://platform.deepseek.com/api_keys',
  policyUrl: 'https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html',
}

const PROVIDERS = Object.freeze({
  ai: {
    openrouter: {
      name: 'OpenRouter',
      keyUrl: 'https://openrouter.ai/keys',
      policyUrl: 'https://openrouter.ai/privacy',
    },
    openai: {
      name: 'OpenAI',
      keyUrl: 'https://platform.openai.com/api-keys',
      policyUrl: 'https://openai.com/policies/privacy-policy/',
    },
    deepseek: DEEPSEEK,
    anthropic: {
      name: 'Anthropic',
      keyUrl: 'https://platform.claude.com/settings/keys',
      policyUrl: 'https://www.anthropic.com/legal/privacy',
    },
    gemini: {
      name: 'Google Gemini',
      keyUrl: 'https://aistudio.google.com/apikey',
      policyUrl: 'https://policies.google.com/privacy',
    },
    xai: {
      name: 'xAI',
      keyUrl: 'https://console.x.ai',
      policyUrl: 'https://x.ai/legal/privacy-policy',
    },
    mistral: {
      name: 'Mistral',
      keyUrl: 'https://console.mistral.ai/api-keys',
      policyUrl: 'https://legal.mistral.ai/terms/privacy-policy',
    },
  },
  search: {
    tavily: {
      name: 'Tavily',
      keyUrl: 'https://app.tavily.com/home',
      policyUrl: 'https://tavily.com/privacy',
    },
    serper: {
      name: 'Serper',
      keyUrl: 'https://serper.dev/api-keys',
      policyUrl: 'https://serper.dev/privacy',
    },
    deepseek: DEEPSEEK,
  },
} as const satisfies SlotTable)

/** A provider's name, links, by the slot it serves: DeepSeek AI and DeepSeek search are two entries. */
export function providerInfo(slot: KeySlot, provider: string): ProviderInfo {
  const offered: Readonly<Record<string, ProviderInfo>> = PROVIDERS[slot]

  return offered[provider] ?? { name: provider, keyUrl: '', policyUrl: '' }
}
