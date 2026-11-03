import { join } from 'node:path'

import type { Logger } from '@/core/logging/logger'
import type { Dialect, Storage } from '@/core/types/storage'
import { BRAND } from '@/core/brand'
import { OperatorConfigError } from '@/core/config/operator-errors'
import { formatErrForLog } from '@/core/security/credentials'
import { BACKUPS_SUBDIR, backupAndPrune, backupTarget } from '@/persistence/backup'
import { SchemaAheadError } from '@/persistence/errors'
import { migrate } from '@/persistence/migrations/runner'

const PRE_MIGRATION_SUBDIR = 'pre-migration'

interface MigrateWithBackupOptions {
  readonly dataDir: string
  readonly logger: Logger
}

/** `migrate` with the daemon's pre-migration snapshot, and the schema-ahead refusal worded with the
 *  folder that snapshot lands in. */
export async function migrateWithBackup(
  db: Storage,
  dialect: Dialect,
  options: MigrateWithBackupOptions
): Promise<number> {
  const { dataDir, logger } = options
  const backupDir = join(dataDir, BACKUPS_SUBDIR, PRE_MIGRATION_SUBDIR)

  try {
    return await migrate(db, dialect, {
      logger,
      backup: (source) => backupBeforeMigrating(source, backupDir, logger),
    })
  } catch (err: unknown) {
    throw err instanceof SchemaAheadError ? toOperatorError(err) : err
  }
}

async function backupBeforeMigrating(db: Storage, dir: string, logger: Logger): Promise<void> {
  const target = backupTarget(dir)

  try {
    await backupAndPrune({ db, target, logger })
    logger.info('migration.backup_taken', { path: target })
  } catch (err: unknown) {
    logger.warn('migration.backup_failed', { path: target, err: formatErrForLog(err) })
  }
}

function toOperatorError(err: SchemaAheadError): OperatorConfigError {
  return new OperatorConfigError(err.message, {
    key: 'errors.dbSchemaAhead',
    params: {
      upgrade: `${BRAND.name} upgrade`,
      restore: `${BRAND.name} db restore <file>`,
      folder: join(BACKUPS_SUBDIR, PRE_MIGRATION_SUBDIR),
    },
  })
}
