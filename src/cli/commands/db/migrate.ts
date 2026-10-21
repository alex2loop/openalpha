import { join } from 'node:path'

import type { ParsedArgs } from '@/cli/parsing/args'
import type { CliApp } from '@/cli/types'
import type { Locale } from '@/core/types/locale'
import type { MigrationRollbackResolution } from '@/persistence/api'
import { createCommand, createGroup, type Group } from '@/cli/command'
import { CLI_COMMAND_METADATA, CLI_FLAG_DESCRIPTIONS } from '@/cli/metadata'
import { flagBool, flagString } from '@/cli/parsing/args'
import { fail, hint, success } from '@/cli/ui/colors'
import { confirm, declined, defaultPrompt } from '@/cli/ui/prompt'
import { formatErrForLog } from '@/core/security/credentials'
import { pluralKey, t } from '@/i18n'
import {
  BACKUPS_SUBDIR,
  backupAndPrune,
  backupTarget,
  MIGRATIONS,
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

type RollbackStep =
  | MigrationRollbackResolution
  | { readonly kind: 'at_target'; readonly id: string }

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
    flags: {
      to: { type: 'string', describe: { key: 'cliHelp.flagDbMigrateDownTo' } },
      yes: { type: 'boolean', describe: CLI_FLAG_DESCRIPTIONS.skipConfirmation },
    },
  },
  needs: { bootScope: 'persistence', startup: 'none', daemon: 'stopped' },
  run: runMigrationDown,
})

/** `--to` rolls back every migration after the one named, newest first; without it, only the
 *  newest. Each step re-resolves, so a history that stops being reversible halfway stops there. */
async function runMigrationDown(args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const to = flagString(args, 'to')

  if (to !== undefined && !MIGRATIONS.some((migration) => migration.id === to)) {
    app.err(fail(t(locale, 'cli.dbMigrationTargetUnknown', { id: to })))
    return EXIT_ERROR
  }

  const first = await resolveRollbackStep(app, to)

  if (first.kind !== 'ready') {
    printMigrationRollbackBlock(app, first)
    return first.kind === 'none' || first.kind === 'at_target' ? EXIT_OK : EXIT_ERROR
  }

  if (to === undefined) {
    app.out(hint(t(locale, 'cli.dbMigrationRollbackWarning', { id: first.id })))
  }

  if (app.resolve('dialect').name === 'postgres') {
    app.out(hint(t(locale, 'cli.dbMigrationRollbackPostgresNoSnapshot')))
  }

  if (!(await confirmMigrationRollback(args, app, { id: first.id, to }))) {
    return declined(app)
  }

  if (!(await backUpBeforeRollback(app))) {
    return EXIT_ERROR
  }

  return await rollBackSteps(app, first.id, to)
}

async function rollBackSteps(
  app: CliApp,
  firstId: string,
  to: string | undefined
): Promise<number> {
  const locale = app.config.locale.language
  let step: RollbackStep = { kind: 'ready', id: firstId }

  while (step.kind === 'ready') {
    const result = await rollbackMigration(app.resolve('storage'), app.resolve('dialect'), {
      expectedId: step.id,
      logger: app.resolve('logger'),
    })

    if (result.kind === 'history_changed') {
      app.err(fail(t(locale, 'cli.dbMigrationRollbackHistoryChanged')))
      return EXIT_ERROR
    }

    app.out(success(t(locale, 'cli.dbMigrationRolledBack', { id: result.id })))
    step = to === undefined ? { kind: 'none' } : await resolveRollbackStep(app, to)
  }

  if (step.kind === 'none' || step.kind === 'at_target') {
    return EXIT_OK
  }

  printMigrationRollbackBlock(app, step)
  return EXIT_ERROR
}

/** The next migration to roll back; one at or below `to` is where a `--to` rollback ends. */
async function resolveRollbackStep(app: CliApp, to: string | undefined): Promise<RollbackStep> {
  const resolution = await resolveMigrationRollback(app.resolve('storage'), app.resolve('dialect'))
  const settled =
    resolution.kind === 'none' || resolution.kind === 'orphan' || resolution.kind === 'gap'

  if (to === undefined || settled || resolution.id.localeCompare(to) > 0) {
    return resolution
  }

  return { kind: 'at_target', id: to }
}

function printMigrationRollbackBlock(
  app: CliApp,
  resolution: Exclude<RollbackStep, { readonly kind: 'ready' }>
): void {
  const locale = app.config.locale.language

  if (resolution.kind === 'none') {
    app.out(success(t(locale, 'cli.dbMigrationRollbackNone')))
    return
  }

  if (resolution.kind === 'at_target') {
    app.out(success(t(locale, 'cli.dbMigrationRollbackAtTarget', { id: resolution.id })))
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
  target: { readonly id: string; readonly to: string | undefined }
): Promise<boolean> {
  if (flagBool(args, 'yes')) {
    return true
  }

  const locale = app.config.locale.language
  const question =
    target.to === undefined
      ? t(locale, 'cli.dbMigrationRollbackConfirm', { id: target.id })
      : t(locale, 'cli.dbMigrationRollbackToConfirm', { id: target.to })

  return confirm(defaultPrompt(), question, locale)
}

/** SQLite only: PostgreSQL rolls back in one transaction per step and gets no snapshot. */
async function backUpBeforeRollback(app: CliApp): Promise<boolean> {
  if (app.resolve('dialect').name !== 'sqlite') {
    return true
  }

  const locale = app.config.locale.language
  const target = backupTarget(join(app.config.paths.dataDir, BACKUPS_SUBDIR, PRE_ROLLBACK_SUBDIR))

  try {
    await backupAndPrune({ db: app.resolve('storage'), target, logger: app.resolve('logger') })
  } catch (err: unknown) {
    app.resolve('logger').error('migration.rollback_backup_failed', {
      path: target,
      err: formatErrForLog(err),
    })
    app.err(fail(t(locale, 'cli.dbMigrationRollbackBackupFailed', { path: target })))

    return false
  }

  app.out(success(t(locale, 'cli.dbBackedUp', { target })))

  return true
}

/** The arguments that roll the schema back to `to`, for `upgrade` to run on the newer binary. */
export function migrateDownArgs(to: string, assumeYes: boolean): readonly string[] {
  return [
    CLI_COMMAND_METADATA.db.name,
    dbMigrateGroup.name,
    dbMigrateDownCommand.name,
    '--to',
    to,
    ...(assumeYes ? ['--yes'] : []),
  ]
}

export const dbMigrateGroup: Group = createGroup({
  name: 'migrate',
  summary: { key: 'cliHelp.dbMigrateSummary' },
  default: 'up',
  subcommands: [dbMigrateUpCommand, dbMigrateDownCommand],
})
