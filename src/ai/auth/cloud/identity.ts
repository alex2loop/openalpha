import type { AccessToken } from '@/ai/auth/types'
import type { CloudIdentity } from '@/ai/catalog'
import { fetchAzureToken } from '@/ai/auth/cloud/azure'
import { fetchGoogleToken } from '@/ai/auth/cloud/google'

type Env = Readonly<Record<string, string | undefined>>

/** The variables each cloud's own SDKs read, so an account already set up for them works here. */
export const IDENTITY_ENV = {
  google: ['GOOGLE_APPLICATION_CREDENTIALS'],
  azure: ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'],
} as const satisfies Record<CloudIdentity, readonly string[]>

/** Undefined until every variable the identity needs is set. */
export function resolveTokenFetcher(
  identity: CloudIdentity,
  env: Env
): (() => Promise<AccessToken>) | undefined {
  if (identity === 'google') {
    const [credentialsPath] = valuesOf(IDENTITY_ENV.google, env) ?? []

    return credentialsPath === undefined ? undefined : () => fetchGoogleToken(credentialsPath)
  }

  const [tenantId, clientId, clientSecret] = valuesOf(IDENTITY_ENV.azure, env) ?? []

  return tenantId === undefined || clientId === undefined || clientSecret === undefined
    ? undefined
    : () => fetchAzureToken({ tenantId, clientId, clientSecret })
}

export function hasIdentityEnv(identity: CloudIdentity, env: Env): boolean {
  return valuesOf(IDENTITY_ENV[identity], env) !== undefined
}

function valuesOf(names: readonly string[], env: Env): readonly string[] | undefined {
  const values = names.map((name) => env[name] ?? '')

  return values.every((value) => value !== '') ? values : undefined
}
