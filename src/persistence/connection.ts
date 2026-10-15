import type { ResolvedStorageConfig } from '@/core/config/resolve'
import type { Logger } from '@/core/logging/logger'
import type { Dialect, Storage } from '@/core/types/storage'
import { openPostgres, postgresDialect, resetPostgres } from '@/persistence/engines/postgres'
import { openSqlite, resetSqlite, sqliteDialect } from '@/persistence/engines/sqlite'

export interface OpenedPersistence {
  readonly storage: Storage
  readonly dialect: Dialect
}

export async function openPersistence(
  config: ResolvedStorageConfig,
  logger: Logger
): Promise<OpenedPersistence> {
  if (config.engine === 'sqlite') {
    return { storage: openSqlite(config.path, logger), dialect: sqliteDialect }
  }

  const storage = await openPostgres({ url: config.url, schema: config.schema, logger })

  return { storage, dialect: postgresDialect }
}

export async function resetPersistence(
  config: ResolvedStorageConfig,
  logger: Logger
): Promise<number> {
  if (config.engine === 'sqlite') {
    return resetSqlite({ dbPath: config.path, logger })
  }

  return resetPostgres({ url: config.url, schema: config.schema, logger })
}
