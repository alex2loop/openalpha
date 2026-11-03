import { consentId, type KeySlot } from '@/web/edition/keys-store'

interface ProviderInfo {
  readonly name: string
  /** Where the visitor makes a key of their own. */
  readonly keyUrl: string
  /** The provider's own privacy policy, which the consent notice points to. */
  readonly policyUrl: string
}

const PROVIDERS: Readonly<Record<string, ProviderInfo>> = Object.freeze({
  [consentId('ai', 'openrouter')]: {
    name: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/keys',
    policyUrl: 'https://openrouter.ai/privacy',
  },
  [consentId('ai', 'openai')]: {
    name: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    policyUrl: 'https://openai.com/policies/privacy-policy/',
  },
  [consentId('ai', 'deepseek')]: {
    name: 'DeepSeek',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    policyUrl: 'https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html',
  },
  [consentId('search', 'tavily')]: {
    name: 'Tavily',
    keyUrl: 'https://app.tavily.com/home',
    policyUrl: 'https://tavily.com/privacy',
  },
  [consentId('search', 'serper')]: {
    name: 'Serper',
    keyUrl: 'https://serper.dev/api-keys',
    policyUrl: 'https://serper.dev/privacy',
  },
  [consentId('search', 'deepseek')]: {
    name: 'DeepSeek',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    policyUrl: 'https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html',
  },
})

/** A provider's name, links, by the slot it serves: DeepSeek AI and DeepSeek search are two entries. */
export function providerInfo(slot: KeySlot, provider: string): ProviderInfo {
  return PROVIDERS[consentId(slot, provider)] ?? { name: provider, keyUrl: '', policyUrl: '' }
}
