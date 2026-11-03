import type { AccessToken } from '@/ai/auth/types'
import type { CloudIdentity } from '@/ai/catalog'
import { fetchAzureToken } from '@/ai/auth/cloud/azure'
import { fetchGoogleToken } from '@/ai/auth/cloud/google'
import { type Env, IDENTITY_ENV, identityValues } from '@/ai/auth/cloud/identity'

/** Undefined until every variable the identity needs is set. */
export function resolveTokenFetcher(
  identity: CloudIdentity,
  env: Env
): (() => Promise<AccessToken>) | undefined {
  if (identity === 'google') {
    const [credentialsPath] = identityValues(IDENTITY_ENV.google, env) ?? []

    return credentialsPath === undefined ? undefined : () => fetchGoogleToken(credentialsPath)
  }

  const [tenantId, clientId, clientSecret] = identityValues(IDENTITY_ENV.azure, env) ?? []

  return tenantId === undefined || clientId === undefined || clientSecret === undefined
    ? undefined
    : () => fetchAzureToken({ tenantId, clientId, clientSecret })
}
