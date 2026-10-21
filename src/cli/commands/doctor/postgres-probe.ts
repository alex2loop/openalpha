import type { ResolvedStorageConfig } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import type { Migration } from '@/persistence/api'
import { silentLogger } from '@/core/logging/logger'
import { t } from '@/i18n'
import {
  MIGRATION_IDS_SQL,
  MIGRATIONS_TABLE,
  openPersistence,
  POSTGRES_MIGRATIONS_TABLE_SQL,
} from '@/persistence/api'

import type { DoctorFinding, DoctorStatus } from './types'
import { migrationFinding } from './local-probes'

interface MigrationRow {
  readonly id: string
}

interface TableRow {
  readonly name: string | null
}

interface PostgresDatabaseProbeOptions {
  readonly status: DoctorStatus
  readonly storage: Extract<ResolvedStorageConfig, { readonly engine: 'postgres' }>
  readonly detail: string
  readonly locale: Locale
}

export async function probePostgresDatabase(
  storage: Extract<ResolvedStorageConfig, { readonly engine: 'postgres' }>,
  migrations: readonly Migration[],
  locale: Locale
): Promise<DoctorFinding> {
  let opened: Awaited<ReturnType<typeof openPersistence>> | undefined

  try {
    opened = await openPersistence(storage, silentLogger)
    const migrationTable = await opened.storage.query<TableRow>(POSTGRES_MIGRATIONS_TABLE_SQL)

    if (migrationTable[0]?.name === null || migrationTable[0] === undefined) {
      return databaseProbe({
        status: 'fail',
        storage,
        detail: t(locale, 'cli.doctorMigrationsTableMissing', { table: MIGRATIONS_TABLE }),
        locale,
      })
    }

    const applied = await opened.storage.query<MigrationRow>(MIGRATION_IDS_SQL)

    return migrationProbe({
      storage,
      migrations,
      applied,
      locale,
    })
  } catch {
    return databaseProbe({
      status: 'fail',
      storage,
      detail: t(locale, 'cli.doctorCannotConnectDatabase'),
      locale,
    })
  } finally {
    if (opened !== undefined) {
      await opened.storage.close().catch(() => undefined)
    }
  }
}

function migrationProbe(options: {
  readonly storage: Extract<ResolvedStorageConfig, { readonly engine: 'postgres' }>
  readonly migrations: readonly Migration[]
  readonly applied: readonly MigrationRow[]
  readonly locale: Locale
}): DoctorFinding {
  const finding = migrationFinding(options.locale, options.migrations, options.applied)

  return databaseProbe({ ...finding, storage: options.storage, locale: options.locale })
}

function databaseProbe(options: PostgresDatabaseProbeOptions): DoctorFinding {
  return {
    status: options.status,
    detail: t(options.locale, 'cli.doctorPostgresSchema', {
      schema: options.storage.schema,
      detail: options.detail,
    }),
  }
}
