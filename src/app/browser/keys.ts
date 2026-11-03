import type { BrowserKeys } from '@/app/server/wire/worker'
import type { ResolvedConfig } from '@/core/config/resolve'
import { type CredentialSource, findProviderById } from '@/ai/api'
import { LLMError } from '@/core/errors'
import { registerKnownSecret } from '@/core/security/credentials'

/** The AI providers whose API answers a browser; a key for any other is ignored. Each has its own
 *  key variable, so a visitor can hold one key per provider. */
export const BROWSER_AI_PROVIDERS = Object.freeze([
  'openrouter',
  'openai',
  'deepseek',
  'anthropic',
  'gemini',
  'xai',
  'mistral',
] as const)

/** Anthropic answers a browser only to a request that declares the visitor chose to call it. */
const ANTHROPIC_BROWSER_HEADER = 'anthropic-dangerous-direct-browser-access'

/** The provider the page offers first, and the one a missing key is asked for. */
const DEFAULT_AI_PROVIDER = 'openrouter' satisfies (typeof BROWSER_AI_PROVIDERS)[number]

/** The tier whose first model decides which AI key a run needs: `/suggest` argues on it. */
const MODEL_TIER = 'debate'

/** The search providers that passed the CORS check, with the variable each one's key is read from.
 *  DeepSeek search has a variable of its own, so a DeepSeek AI key is never taken for a search key
 *  and a search key is never taken for an AI key. */
const SEARCH_KEY_VARIABLES: Readonly<Record<string, string>> = Object.freeze({
  tavily: 'TAVILY_API_KEY',
  serper: 'SERPER_API_KEY',
  deepseek: 'DEEPSEEK_SEARCH_API_KEY',
})

/** The hosted search backends a page can use. */
export const BROWSER_SEARCH_PROVIDERS: readonly string[] = Object.freeze(
  Object.keys(SEARCH_KEY_VARIABLES)
)

type KeyEnv = Readonly<Record<string, string | undefined>>
type BrowserAiProvider = (typeof BROWSER_AI_PROVIDERS)[number]

export interface BrowserKeyring {
  /** Replaces the keys. Each value joins the credential scrubber first, so a record written after
   *  this call can never hold one. The new key is used from the next request, including the later
   *  requests of a run already going: a request already sent keeps the key it carried. */
  update(keys: BrowserKeys): void
  /** The variable name to key value map the credential sources read on every request. */
  env(): KeyEnv
}

export function createBrowserKeyring(): BrowserKeyring {
  let current: KeyEnv = Object.freeze({})

  return {
    update(keys) {
      const next = toEnv(keys)

      for (const value of Object.values(next)) {
        if (value !== undefined) {
          registerKnownSecret(value)
        }
      }

      current = next
    },
    env: () => current,
  }
}

/** One source per provider the page can call, reading the key at the moment of each request. Without
 *  a key it refuses before anything is sent. */
export function createKeyringCredentials(keyring: BrowserKeyring): readonly CredentialSource[] {
  return BROWSER_AI_PROVIDERS.map((provider) => ({
    provider,
    async authHeaders(keyHeaders) {
      const key = keyring.env()[aiKeyVariable(provider)]

      if (key === undefined) {
        throw new LLMError('auth', `no ${provider} key is set`)
      }

      return { ...keyHeaders(key), ...toBrowserHeaders(provider) }
    },
  }))
}

/** What a page's call adds to the transport's own headers: only what a provider insists on for a
 *  browser origin. A browser call is preflighted, and a provider that lists the headers it allows
 *  (Mistral: Authorization and Content-Type) refuses any other. */
function toBrowserHeaders(provider: BrowserAiProvider): Readonly<Record<string, string>> {
  return findProviderById(provider)?.transport === 'anthropic_messages'
    ? { [ANTHROPIC_BROWSER_HEADER]: 'true' }
    : {}
}

/** Every variable name a key can arrive under: the config resolves against these, so a feature that
 *  needs a key finds its variable set and the keyring answers with the real value later. */
export function listKeyVariables(): readonly string[] {
  return [...BROWSER_AI_PROVIDERS.map(aiKeyVariable), ...Object.values(SEARCH_KEY_VARIABLES)]
}

export function aiKeyVariable(provider: BrowserAiProvider): string {
  return findProviderById(provider)?.apiKeyEnv ?? ''
}

/** The AI provider a run needs a key for: the one its `debate` tier names first. */
export function readModelProvider(config: Pick<ResolvedConfig, 'modelTiers'>): BrowserAiProvider {
  const named = config.modelTiers[MODEL_TIER]?.[0]?.provider

  return BROWSER_AI_PROVIDERS.find((provider) => provider === named) ?? DEFAULT_AI_PROVIDER
}

export function hasAiKey(env: KeyEnv, provider: BrowserAiProvider): boolean {
  return env[aiKeyVariable(provider)] !== undefined
}

/** The search provider the keyring holds a key for, in the order the providers are offered; the
 *  variable is where that key is read from. None means search runs keyless. */
export function readSearchSelection(
  env: KeyEnv
): { readonly provider: string; readonly variable: string } | undefined {
  const found = Object.entries(SEARCH_KEY_VARIABLES).find(
    ([, variable]) => env[variable] !== undefined
  )

  return found === undefined ? undefined : { provider: found[0], variable: found[1] }
}

function toEnv(keys: BrowserKeys): KeyEnv {
  const env: Record<string, string | undefined> = {}
  const { ai = [], search } = keys

  for (const entry of ai) {
    if (isAiProvider(entry.provider)) {
      env[aiKeyVariable(entry.provider)] = entry.key.trim() || undefined
    }
  }

  const searchVariable = search === undefined ? undefined : SEARCH_KEY_VARIABLES[search.provider]

  if (search !== undefined && searchVariable !== undefined) {
    env[searchVariable] = search.key.trim() || undefined
  }

  return Object.freeze(env)
}

function isAiProvider(provider: string): provider is BrowserAiProvider {
  return BROWSER_AI_PROVIDERS.some((accepted) => accepted === provider)
}
