import type { ConfigHost, DataLocation } from '@/core/config/paths'
import type { RawStorage } from '@/core/config/schema'
import { MissingEnvError } from '@/core/config/operator-errors'
import { resolveSqliteDatabasePath } from '@/core/config/paths'

export type ResolvedStorageConfig =
  | { readonly engine: 'sqlite'; readonly path: string }
  | { readonly engine: 'postgres'; readonly url: string; readonly schema: string }

export function resolveStorageConfig(
  raw: RawStorage | undefined,
  location: DataLocation,
  env: ConfigHost['env']
): ResolvedStorageConfig {
  if (raw === undefined || raw.engine === 'sqlite') {
    return {
      engine: 'sqlite',
      path: resolveSqliteDatabasePath(location, raw?.path),
    }
  }

  const url = env[raw.url_env]

  if (url === undefined || url === '') {
    throw new MissingEnvError(raw.url_env, 'storage', {
      path: ['storage', 'url_env'],
      effect: 'storage',
    })
  }

  return { engine: 'postgres', url, schema: raw.schema }
}
