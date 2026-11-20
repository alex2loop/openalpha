import type { ResolvedStorageConfig } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import type { Storage } from '@/core/types/storage'
import type { Migration } from '@/persistence/api'
import { silentLogger } from '@/core/logging/silent-logger'
import { t } from '@/i18n'
import {
  MIGRATION_IDS_SQL,
  MIGRATIONS_TABLE,
  POSTGRES_MIGRATIONS_TABLE_SQL,
} from '@/persistence/api'
import { openPersistence } from '@/persistence/node-api'
import { PROFILE_CURRENCY_SQL } from '@/trading/api'

import type { DoctorFinding, DoctorStatus } from './types'
import { currencyMismatchDetail, migrationFinding } from './local-probes'

interface MigrationRow {
  readonly id: string
}

interface TableRow {
  readonly name: string | null
}

interface ProfileCurrencyRow {
  readonly base_currency: string
}

type PostgresStorageConfig = Extract<ResolvedStorageConfig, { readonly engine: 'postgres' }>

interface PostgresProbeOptions {
  readonly storage: PostgresStorageConfig
  readonly migrations: readonly Migration[]
  readonly locale: Locale
  /** The `[locale] currency` the book must have been opened in. */
  readonly currency?: string
}

interface PostgresDatabaseProbeOptions {
  readonly status: DoctorStatus
  readonly storage: PostgresStorageConfig
  readonly detail: string
  readonly locale: Locale
}

export async function probePostgresDatabase(options: PostgresProbeOptions): Promise<DoctorFinding> {
  const { storage, migrations, locale } = options
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
    const migrated = migrationProbe({
      storage,
      migrations,
      applied,
      locale,
    })

    return migrated.status === 'ok'
      ? await currencyProbe(opened.storage, options, migrated)
      : migrated
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

async function currencyProbe(
  storage: Storage,
  options: PostgresProbeOptions,
  migrated: DoctorFinding
): Promise<DoctorFinding> {
  const rows = await storage.query<ProfileCurrencyRow>(PROFILE_CURRENCY_SQL)
  const stored = rows[0]?.base_currency
  const mismatch = currencyMismatchDetail(options.locale, options.currency, stored)

  return mismatch === null
    ? migrated
    : databaseProbe({
        status: 'fail',
        storage: options.storage,
        detail: mismatch,
        locale: options.locale,
      })
}

function migrationProbe(options: {
  readonly storage: PostgresStorageConfig
  readonly migrations: readonly Migration[]
  readonly applied: readonly MigrationRow[]
  readonly locale: Locale
}): DoctorFinding {
  const finding = migrationFinding(options.locale, {
    migrations: options.migrations,
    applied: options.applied,
  })

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
