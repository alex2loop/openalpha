import type { BrowserKeys } from '@/app/server/wire/worker'
import { type CredentialSource, findProviderById } from '@/ai/api'
import { LLMError } from '@/core/errors'
import { registerKnownSecret } from '@/core/security/credentials'

/** The AI providers whose API answers a browser; a key for any other is ignored. */
export const BROWSER_AI_PROVIDERS = Object.freeze(['openrouter', 'openai', 'deepseek'] as const)

/** The search providers that passed the CORS check, with the variable each one's key is read from. */
const SEARCH_KEY_VARIABLES: Readonly<Record<string, string>> = Object.freeze({
  tavily: 'TAVILY_API_KEY',
  serper: 'SERPER_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
})

type KeyEnv = Readonly<Record<string, string | undefined>>
type BrowserAiProvider = (typeof BROWSER_AI_PROVIDERS)[number]

/** The provider the page offers first, and the one a missing key is asked for. */
export const DEFAULT_AI_PROVIDER: BrowserAiProvider = 'openrouter'

export interface BrowserKeyring {
  /** Replaces the keys. Each value joins the credential scrubber first, so a record written after
   *  this call can never hold one. A request already on the wire keeps the key it was sent with. */
  update(keys: BrowserKeys): void
  /** The variable name to key value map the credential sources read on every request. */
  env(): KeyEnv
}

/** Every variable name a key can arrive under: the config resolves against these, so a feature
 *  that needs a key finds its variable set and the keyring answers with the real value later. */
export const BROWSER_KEY_VARIABLES: readonly string[] = Object.freeze([
  ...BROWSER_AI_PROVIDERS.map(aiKeyVariable),
  ...Object.values(SEARCH_KEY_VARIABLES),
])

/** Whether the visitor has pasted a key for any accepted AI provider. */
export function hasAiKey(env: KeyEnv): boolean {
  return BROWSER_AI_PROVIDERS.some((provider) => env[aiKeyVariable(provider)] !== undefined)
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

/** Providers that sign in with another provider's key: OpenRouter's headline endpoint takes the
 *  same key as its chat one. */
const SHARED_KEY_PROVIDERS: Readonly<Record<string, BrowserAiProvider>> = Object.freeze({
  'openrouter-decisions': 'openrouter',
})

/** One source per provider the page can call, reading the key at the moment of each request so a
 *  change applies to the next call. Without a key it refuses before anything is sent. */
export function createKeyringCredentials(keyring: BrowserKeyring): readonly CredentialSource[] {
  const keyed: readonly (readonly [string, BrowserAiProvider])[] = [
    ...BROWSER_AI_PROVIDERS.map((provider) => [provider, provider] as const),
    ...Object.entries(SHARED_KEY_PROVIDERS),
  ]

  return keyed.map(([provider, owner]) => ({
    provider,
    async authHeaders() {
      const key = keyring.env()[aiKeyVariable(owner)]

      if (key === undefined) {
        throw new LLMError('auth', `no ${owner} key is set`)
      }

      return { authorization: `Bearer ${key}` }
    },
  }))
}

function toEnv(keys: BrowserKeys): KeyEnv {
  const env: Record<string, string | undefined> = {}
  const { ai, search } = keys

  if (ai !== undefined && isAiProvider(ai.provider)) {
    env[aiKeyVariable(ai.provider)] = ai.key.trim() || undefined
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

export function aiKeyVariable(provider: BrowserAiProvider): string {
  return findProviderById(provider)?.apiKeyEnv ?? ''
}
