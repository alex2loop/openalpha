import type { MessageKey } from '@/i18n'
import type { KeySlot, SLOT_PROVIDERS } from '@/web/edition/keys-store'
import { tr } from '@/web/text/tr'

export interface ProviderInfo {
  readonly name: string
  /** Where the visitor makes a key of their own. */
  readonly keyUrl: string
  /** The provider's own privacy policy, which the consent notice points to. */
  readonly policyUrl: string
  /** Passes a request on to the model's host, which the provider picks, instead of answering it. */
  readonly isRouter?: boolean
}

interface ProviderEntry extends Omit<ProviderInfo, 'name'> {
  readonly name: MessageKey
}

/** Every provider a slot offers has an entry, and none the slot does not. */
type SlotTable = {
  readonly [S in KeySlot]: Readonly<Record<(typeof SLOT_PROVIDERS)[S][number], ProviderEntry>>
}

// DeepSeek serves both slots with the same name and links; each slot still holds its own key.
const DEEPSEEK: ProviderEntry = {
  name: 'ui.office.edition.providerName.deepseek',
  keyUrl: 'https://platform.deepseek.com/api_keys',
  policyUrl: 'https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html',
}

const PROVIDERS = Object.freeze({
  ai: {
    openrouter: {
      name: 'ui.office.edition.providerName.openrouter',
      keyUrl: 'https://openrouter.ai/keys',
      policyUrl: 'https://openrouter.ai/privacy',
      isRouter: true,
    },
    openai: {
      name: 'ui.office.edition.providerName.openai',
      keyUrl: 'https://platform.openai.com/api-keys',
      policyUrl: 'https://openai.com/policies/privacy-policy/',
    },
    deepseek: DEEPSEEK,
    anthropic: {
      name: 'ui.office.edition.providerName.anthropic',
      keyUrl: 'https://platform.claude.com/settings/keys',
      policyUrl: 'https://www.anthropic.com/legal/privacy',
    },
    gemini: {
      name: 'ui.office.edition.providerName.gemini',
      keyUrl: 'https://aistudio.google.com/apikey',
      policyUrl: 'https://policies.google.com/privacy',
    },
    xai: {
      name: 'ui.office.edition.providerName.xai',
      keyUrl: 'https://console.x.ai',
      policyUrl: 'https://x.ai/legal/privacy-policy',
    },
    mistral: {
      name: 'ui.office.edition.providerName.mistral',
      keyUrl: 'https://console.mistral.ai/api-keys',
      policyUrl: 'https://legal.mistral.ai/terms/privacy-policy',
    },
  },
  search: {
    tavily: {
      name: 'ui.office.edition.providerName.tavily',
      keyUrl: 'https://app.tavily.com/home',
      policyUrl: 'https://tavily.com/privacy',
    },
    serper: {
      name: 'ui.office.edition.providerName.serper',
      keyUrl: 'https://serper.dev/api-keys',
      policyUrl: 'https://serper.dev/privacy',
    },
    deepseek: DEEPSEEK,
  },
} as const satisfies SlotTable)

/** A provider's name, links, by the slot it serves: DeepSeek AI and DeepSeek search are two entries. */
export function providerInfo(slot: KeySlot, provider: string): ProviderInfo {
  const offered: Readonly<Record<string, ProviderEntry>> = PROVIDERS[slot]
  const entry = offered[provider]

  return entry === undefined
    ? { name: provider, keyUrl: '', policyUrl: '' }
    : { ...entry, name: tr(entry.name) }
}
