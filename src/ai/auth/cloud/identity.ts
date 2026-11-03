import type { CloudIdentity } from '@/ai/catalog'
export type Env = Readonly<Record<string, string | undefined>>

/** The variables each cloud's own SDKs read, so an account already set up for them works here. */
export const IDENTITY_ENV = {
  google: ['GOOGLE_APPLICATION_CREDENTIALS'],
  azure: ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'],
} as const satisfies Record<CloudIdentity, readonly string[]>

export function hasIdentityEnv(identity: CloudIdentity, env: Env): boolean {
  return identityValues(IDENTITY_ENV[identity], env) !== undefined
}

/** Every variable's value, or undefined while any is unset. */
export function identityValues(names: readonly string[], env: Env): readonly string[] | undefined {
  const values = names.map((name) => env[name] ?? '')

  return values.every((value) => value !== '') ? values : undefined
}
