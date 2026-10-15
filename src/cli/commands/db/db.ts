import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { CliApp } from '@/cli/types'
import type { ResolvedStorageConfig } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import type { Storage } from '@/persistence/api'
import { createCommand, createGroup, type Group } from '@/cli/command'
import { dbExportCommand } from '@/cli/commands/db/export'
import { dbImportCommand } from '@/cli/commands/db/import'
import { dbMigrateGroup } from '@/cli/commands/db/migrate'
import { usage } from '@/cli/error-output'
import { renderLocalized } from '@/cli/help'
import { CLI_COMMAND_METADATA, CLI_FLAG_DESCRIPTIONS } from '@/cli/metadata'
import { flagBool, flagString } from '@/cli/parsing/args'
import { parseDurationFlag } from '@/cli/parsing/duration'
import { fail, hint, style, success } from '@/cli/ui/colors'
import { formatBytes } from '@/cli/ui/format'
import { confirm, declined, defaultPrompt } from '@/cli/ui/prompt'
import { expandHome } from '@/core/config/resolve'
import { silentLogger } from '@/core/logging/logger'
import { MS_PER_DAY } from '@/core/utils/time'
import { t } from '@/i18n'
import {
  ALL_TABLES,
  BACKUPS_SUBDIR,
  backupSqlite,
  backupTarget,
  countRetention,
  pruneBackups,
  type RetentionConfig,
  type RetentionCounts,
  resetPersistence,
  restoreSqlite,
  runRetention,
  TABLE_NAME_WIDTH,
} from '@/persistence/api'

const PREVIOUS_SUFFIX = '.bak'

const dbIntegrityCommand = createCommand({
  name: 'integrity',
  summary: { key: 'cliHelp.dbIntegritySummary' },
  needs: { bootScope: 'persistence', startup: 'none', daemon: 'any' },
  async run(_args, app): Promise<number> {
    const locale = app.config.locale.language
    const storage = app.resolve('storage')

    if (app.resolve('dialect').name !== 'sqlite') {
      return postgresIntegrityCheck(storage, app, locale)
    }

    const rows = await storage.query<{ readonly integrity_check: string }>('PRAGMA integrity_check')
    const result = rows[0]?.integrity_check ?? 'unknown'

    const text = t(locale, 'cli.dbIntegrity', { result })

    app.out(result === 'ok' ? success(text) : fail(text))

    return result === 'ok' ? 0 : 1
  },
})

// Postgres has no single-statement equivalent to sqlite's PRAGMA integrity_check without an extension (amcheck).
async function postgresIntegrityCheck(
  storage: Storage,
  app: CliApp,
  locale: Locale
): Promise<number> {
  await storage.query('SELECT 1')
  app.out(success(t(locale, 'cli.dbConnectionOk')))
  app.out(hint(t(locale, 'cli.dbDeepIntegrityNotImplemented')))

  return 0
}

const dbCleanupCommand = createCommand({
  name: 'cleanup',
  summary: { key: 'cliHelp.dbCleanupSummary' },
  spec: {
    flags: {
      olderThan: { type: 'string', describe: CLI_FLAG_DESCRIPTIONS.retentionWindow },
      dryRun: { type: 'boolean', describe: CLI_FLAG_DESCRIPTIONS.previewWithoutDeleting },
    },
  },
  needs: { bootScope: 'persistence', startup: 'none', daemon: 'stopped' },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const raw = flagString(args, 'olderThan')

    if (raw === undefined) {
      return usage(app, t(locale, 'cli.dbCleanupUsage'))
    }

    const parsed = parseDurationFlag(raw, '--older-than')

    if (parsed.kind === 'error') {
      return usage(app, renderLocalized(locale, parsed.error))
    }

    if (parsed.ms < MS_PER_DAY) {
      return usage(app, t(locale, 'cli.dbOlderThanMinDay'))
    }

    const retentionDays = parsed.ms / MS_PER_DAY
    const storage = app.resolve('storage')
    const dialect = app.resolve('dialect')
    const logger = app.resolve('logger')
    const config = {
      retentionDays,
      inboxRetentionDays: app.config.retention.inboxDays,
    }

    if (flagBool(args, 'dryRun')) {
      const counts = await countRetention(storage, dialect, { config, logger })
      printRetentionCounts(app, counts, config)
      app.out(hint(t(locale, 'cli.dbDryRunHint')))
      return 0
    }

    const counts = await runRetention(storage, dialect, { config, logger })
    printRetentionCounts(app, counts, config)
    app.out(
      success(
        t(locale, 'cli.dbPrunedSummary', {
          general: retentionDays,
          inbox: config.inboxRetentionDays,
        })
      )
    )

    return 0
  },
})

function printRetentionCounts(app: CliApp, counts: RetentionCounts, config: RetentionConfig): void {
  const locale = app.config.locale.language
  app.out(t(locale, 'cli.dbFieldGeneralWindow', { value: config.retentionDays }))
  app.out(t(locale, 'cli.dbFieldInboxWindow', { value: config.inboxRetentionDays }))
  app.out(t(locale, 'cli.dbFieldSessions', { value: counts.sessions }))
  app.out(t(locale, 'cli.dbFieldSessionRoutes', { value: counts.sessionRoutes }))
  app.out(t(locale, 'cli.dbFieldMemory', { value: counts.memory }))
  app.out(t(locale, 'cli.dbFieldSchedulerRuns', { value: counts.schedulerRuns }))
  app.out(t(locale, 'cli.dbFieldInbox', { value: counts.inbox }))
  app.out(t(locale, 'cli.dbFieldInboxAbandoned', { value: counts.inboxAbandoned }))
  app.out(t(locale, 'cli.dbFieldPairings', { value: counts.pairings }))
  app.out(t(locale, 'cli.dbFieldAlertsTerminal', { value: counts.alertsTerminal }))
  app.out(t(locale, 'cli.dbFieldBriefSnapshots', { value: counts.briefSnapshots }))
  app.out(t(locale, 'cli.dbFieldLlmAttempts', { value: counts.llmAttempts }))
}

const dbStatsCommand = createCommand({
  name: 'stats',
  summary: { key: 'cliHelp.dbStatsSummary' },
  needs: { bootScope: 'persistence', startup: 'none', daemon: 'any' },
  async run(_args, app): Promise<number> {
    const locale = app.config.locale.language
    const storage = app.resolve('storage')

    app.out(style.heading(t(locale, 'cli.dbTableRowsHeading')))
    for (const table of ALL_TABLES) {
      app.out(`  ${table.name.padEnd(TABLE_NAME_WIDTH)} ${await rowCount(storage, table.name)}`)
    }

    app.out('')
    app.out(style.heading(t(locale, 'cli.dbFileSizeHeading')))
    app.out(`  ${await dbFileSizeLine(app.config.storage, locale)}`)

    return 0
  },
})

async function rowCount(storage: Storage, table: string): Promise<number> {
  const rows = await storage.query<{ readonly n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)

  return rows[0]?.n ?? 0
}

async function dbFileSizeLine(storage: ResolvedStorageConfig, locale: Locale): Promise<string> {
  if (storage.engine !== 'sqlite') {
    return hint(t(locale, 'cli.dbNaPostgres'))
  }

  try {
    const { size } = await stat(storage.path)

    return formatBytes(size)
  } catch {
    return hint(t(locale, 'cli.dbNa'))
  }
}

// VACUUM INTO, not a file copy: it writes a consistent snapshot even with the daemon mid-write,
// so no daemon: 'stopped' and no Storage.backup() method. sqlite only — pg has pg_dump.
const dbBackupCommand = createCommand({
  name: 'backup',
  summary: { key: 'cliHelp.dbBackupSummary' },
  spec: {
    flags: {
      path: { type: 'string', describe: { key: 'cliHelp.flagDbBackupPath' } },
      force: { type: 'boolean', describe: { key: 'cliHelp.flagDbBackupForce' } },
    },
  },
  needs: { bootScope: 'persistence', startup: 'none', daemon: 'any' },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language

    if (app.config.storage.engine !== 'sqlite') {
      return usage(app, t(locale, 'cli.dbBackupSqliteOnly'))
    }

    const explicitPath = flagString(args, 'path')
    const explicit = explicitPath === undefined ? undefined : expandHome(explicitPath)
    const dir = join(app.config.paths.dataDir, BACKUPS_SUBDIR)
    const target = explicit ?? backupTarget(dir)

    if (explicit !== undefined && !flagBool(args, 'force') && (await Bun.file(explicit).exists())) {
      return usage(app, t(locale, 'cli.dbBackupTargetExists', { target: explicit }))
    }

    await backupSqlite(app.resolve('storage'), target)

    if (explicit === undefined) {
      await pruneBackups(dir)
    }

    app.out(success(t(locale, 'cli.dbBackedUp', { target })))

    return 0
  },
})

const dbRestoreCommand = createCommand({
  name: 'restore',
  summary: { key: 'cliHelp.dbRestoreSummary' },
  spec: {
    positional: ['source'],
    flags: { yes: { type: 'boolean', describe: CLI_FLAG_DESCRIPTIONS.skipConfirmation } },
  },
  needs: { boot: false, daemon: 'stopped' },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language

    if (app.config.storage.engine !== 'sqlite') {
      return usage(app, t(locale, 'cli.dbRestoreSqliteOnly'))
    }

    const sourceFlag = flagString(args, 'source')
    const source = sourceFlag === undefined ? undefined : expandHome(sourceFlag)

    if (source === undefined) {
      return usage(app, t(locale, 'cli.dbRestoreUsage'))
    }

    const dbPath = app.config.storage.path

    if (
      !(
        flagBool(args, 'yes') ||
        (await confirm(
          defaultPrompt(),
          t(locale, 'cli.dbRestoreConfirm', { path: dbPath }),
          locale
        ))
      )
    ) {
      return declined(app)
    }

    await restoreSqlite({
      dbPath,
      source,
      backupPath: `${dbPath}${PREVIOUS_SUFFIX}`,
      logger: silentLogger,
    })
    app.out(
      success(
        t(locale, 'cli.dbRestored', {
          path: dbPath,
          prev: `${dbPath}${PREVIOUS_SUFFIX}`,
        })
      )
    )

    return 0
  },
})

const dbResetCommand = createCommand({
  name: 'reset',
  summary: { key: 'cliHelp.dbResetSummary' },
  spec: {
    flags: { yes: { type: 'boolean', describe: CLI_FLAG_DESCRIPTIONS.skipConfirmation } },
  },
  needs: { boot: false, daemon: 'stopped' },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const target = resetTarget(app.config.storage)
    const question = t(locale, 'cli.dbResetConfirm', { target })

    if (!(flagBool(args, 'yes') || (await confirm(defaultPrompt(), question, locale)))) {
      return declined(app)
    }

    const applied = await resetPersistence(app.config.storage, silentLogger)

    app.out(success(t(locale, 'cli.dbResetComplete', { target, count: applied })))

    return 0
  },
})

function resetTarget(storage: ResolvedStorageConfig): string {
  if (storage.engine === 'sqlite') {
    return storage.path
  }

  return `postgres schema ${storage.schema}`
}

export const dbCommand: Group = createGroup({
  ...CLI_COMMAND_METADATA.db,
  subcommands: [
    dbMigrateGroup,
    dbIntegrityCommand,
    dbCleanupCommand,
    dbStatsCommand,
    dbBackupCommand,
    dbExportCommand,
    dbImportCommand,
    dbRestoreCommand,
    dbResetCommand,
  ],
})
