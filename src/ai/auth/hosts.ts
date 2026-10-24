import type { CloudIdentity } from '@/ai/catalog'
import { AZURE_LOGIN_HOST } from '@/ai/auth/cloud/azure'
import { GOOGLE_TOKEN_HOST } from '@/ai/auth/cloud/google'
import { CHATGPT_OAUTH_HOST } from '@/ai/auth/providers/chatgpt'
import { findProviderById } from '@/ai/catalog'

const IDENTITY_HOSTS = {
  google: GOOGLE_TOKEN_HOST,
  azure: AZURE_LOGIN_HOST,
} as const satisfies Record<CloudIdentity, string>

/** The hosts a model's credentials are fetched from, beside the one its calls go to: the
 *  subscription login and each cloud's token endpoint, for the providers these models use. */
export function listAuthHosts(models: readonly { readonly provider: string }[]): readonly string[] {
  const urls = models.flatMap(({ provider }) => {
    const entry = findProviderById(provider)

    return [
      ...(entry?.authKind === 'oauth_subscription' ? [CHATGPT_OAUTH_HOST] : []),
      ...(entry?.identity === undefined ? [] : [IDENTITY_HOSTS[entry.identity]]),
    ]
  })

  return [...new Set(urls)].map((url) => new URL(url).host)
}
