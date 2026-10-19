import { join } from 'node:path'

import type { ParsedArgs } from '@/cli/parsing/args'
import type { CliApp } from '@/cli/types'
import type { Locale } from '@/core/types/locale'
import type { MigrationRollbackResolution } from '@/persistence/api'
import { createCommand, createGroup, type Group } from '@/cli/command'
import { CLI_FLAG_DESCRIPTIONS } from '@/cli/metadata'
import { flagBool } from '@/cli/parsing/args'
import { fail, hint, success } from '@/cli/ui/colors'
import { confirm, declined, defaultPrompt } from '@/cli/ui/prompt'
import { formatErrForLog } from '@/core/security/credentials'
import { pluralKey, t } from '@/i18n'
import {
  BACKUPS_SUBDIR,
  backupAndPrune,
  backupTarget,
  migrate,
  migrationStatus,
  resolveMigrationRollback,
  rollbackMigration,
} from '@/persistence/api'
import { formatInstant } from '@/trading/api'

const EXIT_ERROR = 1
const EXIT_OK = 0
const MIGRATION_STATE_WIDTH = 7
const PRE_ROLLBACK_SUBDIR = 'pre-rollback'

type MigrationRollbackBackup =
  | { readonly kind: 'backed_up'; readonly path: string }
  | { readonly kind: 'failed'; readonly path: string; readonly err: unknown }

const dbMigrateUpCommand = createCommand({
  name: 'up',
  summary: { key: 'cliHelp.dbMigrateUpSummary' },
  spec: {
    flags: { status: { type: 'boolean', describe: { key: 'cliHelp.flagDbMigrationStatus' } } },
  },
  needs: { bootScope: 'persistence', startup: 'none', daemon: 'stopped' },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language

    if (flagBool(args, 'status')) {
      return printMigrationStatus(app, locale)
    }

    const applied = await migrate(app.resolve('storage'), app.resolve('dialect'), {
      backupDir: join(app.config.paths.dataDir, BACKUPS_SUBDIR),
      logger: app.resolve('logger'),
    })

    app.out(
      success(
        applied === 0
          ? t(locale, 'cli.dbMigrationUpToDate')
          : t(locale, pluralKey(applied, 'cli.dbMigrationAppliedOne', 'cli.dbMigrationApplied'), {
              count: applied,
            })
      )
    )

    return EXIT_OK
  },
})

async function printMigrationStatus(app: CliApp, locale: Locale): Promise<number> {
  const entries = await migrationStatus(app.resolve('storage'), app.resolve('dialect'))
  const tally = { applied: 0, pending: 0, orphan: 0 }

  for (const entry of entries) {
    tally[entry.state] += 1
    const at =
      entry.appliedAtMs === null
        ? ''
        : `  ${formatInstant(locale, entry.appliedAtMs, app.config.locale.timezone)}`
    app.out(`  ${entry.state.padEnd(MIGRATION_STATE_WIDTH)} ${entry.id}${at}`)
  }

  app.out('')
  app.out(
    t(locale, 'cli.dbMigrationSummary', {
      applied: tally.applied,
      pending: tally.pending,
      orphan: tally.orphan,
    })
  )

  return EXIT_OK
}

const dbMigrateDownCommand = createCommand({
  name: 'down',
  summary: { key: 'cliHelp.dbMigrateDownSummary' },
  spec: {
    flags: { yes: { type: 'boolean', describe: CLI_FLAG_DESCRIPTIONS.skipConfirmation } },
  },
  needs: { bootScope: 'persistence', startup: 'none', daemon: 'stopped' },
  run: runMigrationDown,
})

async function runMigrationDown(args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const storage = app.resolve('storage')
  const dialect = app.resolve('dialect')
  const resolution = await resolveMigrationRollback(storage, dialect)

  if (resolution.kind !== 'ready') {
    printMigrationRollbackBlock(app, resolution)
    return resolution.kind === 'none' ? EXIT_OK : EXIT_ERROR
  }

  app.out(hint(t(locale, 'cli.dbMigrationRollbackWarning', { id: resolution.id })))

  if (dialect.name === 'postgres') {
    app.out(hint(t(locale, 'cli.dbMigrationRollbackPostgresNoSnapshot')))
  }

  if (!(await confirmMigrationRollback(args, app, resolution.id))) {
    return declined(app)
  }

  if (dialect.name === 'sqlite') {
    const backup = await takeMigrationRollbackBackup(app)

    printMigrationRollbackBackup(app, backup)
    if (backup.kind === 'failed') {
      return EXIT_ERROR
    }
  }

  const result = await rollbackMigration(storage, dialect, {
    expectedId: resolution.id,
    logger: app.resolve('logger'),
  })

  if (result.kind === 'history_changed') {
    app.err(fail(t(locale, 'cli.dbMigrationRollbackHistoryChanged')))
    return EXIT_ERROR
  }

  app.out(success(t(locale, 'cli.dbMigrationRolledBack', { id: result.id })))
  return EXIT_OK
}

function printMigrationRollbackBlock(
  app: CliApp,
  resolution: Exclude<MigrationRollbackResolution, { readonly kind: 'ready' }>
): void {
  const locale = app.config.locale.language

  if (resolution.kind === 'none') {
    app.out(success(t(locale, 'cli.dbMigrationRollbackNone')))
    return
  }

  if (resolution.kind === 'irreversible') {
    app.err(fail(t(locale, 'cli.dbMigrationRollbackIrreversible', { id: resolution.id })))
    return
  }

  if (resolution.kind === 'orphan') {
    app.err(fail(t(locale, 'cli.dbMigrationRollbackOrphan', { ids: resolution.ids.join(', ') })))
    return
  }

  app.err(fail(t(locale, 'cli.dbMigrationRollbackGap', { id: resolution.id })))
}

async function confirmMigrationRollback(
  args: ParsedArgs,
  app: CliApp,
  id: string
): Promise<boolean> {
  if (flagBool(args, 'yes')) {
    return true
  }

  const locale = app.config.locale.language
  return confirm(defaultPrompt(), t(locale, 'cli.dbMigrationRollbackConfirm', { id }), locale)
}

function printMigrationRollbackBackup(app: CliApp, backup: MigrationRollbackBackup): void {
  const locale = app.config.locale.language

  if (backup.kind === 'failed') {
    app.resolve('logger').error('migration.rollback_backup_failed', {
      path: backup.path,
      err: formatErrForLog(backup.err),
    })
    app.err(fail(t(locale, 'cli.dbMigrationRollbackBackupFailed', { path: backup.path })))
    return
  }

  app.out(success(t(locale, 'cli.dbBackedUp', { target: backup.path })))
}

async function takeMigrationRollbackBackup(app: CliApp): Promise<MigrationRollbackBackup> {
  const target = backupTarget(join(app.config.paths.dataDir, BACKUPS_SUBDIR, PRE_ROLLBACK_SUBDIR))

  try {
    await backupAndPrune({ db: app.resolve('storage'), target, logger: app.resolve('logger') })

    return { kind: 'backed_up', path: target }
  } catch (err: unknown) {
    return { kind: 'failed', path: target, err }
  }
}

export const dbMigrateGroup: Group = createGroup({
  name: 'migrate',
  summary: { key: 'cliHelp.dbMigrateSummary' },
  default: 'up',
  subcommands: [dbMigrateUpCommand, dbMigrateDownCommand],
})
