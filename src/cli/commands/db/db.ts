import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { CliApp } from '@/cli/types'
import type { ResolvedStorageConfig } from '@/core/config/resolve'
import type { Logger } from '@/core/logging/logger'
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
import { confirm, confirmDefaultYes, declined, defaultPrompt } from '@/cli/ui/prompt'
import { expandHome } from '@/core/config/resolve'
import { silentLogger } from '@/core/logging/logger'
import { MS_PER_DAY } from '@/core/utils/time'
import { pluralKey, t } from '@/i18n'
import {
  ALL_TABLES,
  BACKUPS_SUBDIR,
  backupAndPrune,
  backupSqlite,
  backupTarget,
  countRetention,
  openPersistence,
  type RetentionConfig,
  type RetentionCounts,
  resetPersistence,
  restoreSqlite,
  runRetention,
  TABLE_NAME_WIDTH,
} from '@/persistence/api'

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
    // `--older-than` sets the general window only; the history window never drops below it.
    const config = {
      retentionDays,
      historyRetentionDays: Math.max(app.config.retention.historyDays, retentionDays),
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
          history: config.historyRetentionDays,
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
  app.out(t(locale, 'cli.dbFieldHistoryWindow', { value: config.historyRetentionDays }))
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
  app.out(t(locale, 'cli.dbFieldRuns', { value: counts.runs }))
  app.out(t(locale, 'cli.dbFieldNotices', { value: counts.notices }))
  app.out(t(locale, 'cli.dbFieldRestingExits', { value: counts.restingExits }))
  app.out(t(locale, 'cli.dbFieldSpentJobs', { value: counts.spentJobs }))
  app.out(t(locale, 'cli.dbFieldSuggestions', { value: counts.suggestions }))
  app.out(t(locale, 'cli.dbFieldFactorLog', { value: counts.factorLog }))
  app.out(t(locale, 'cli.dbFieldThemeOutcomes', { value: counts.themeOutcomes }))
  app.out(t(locale, 'cli.dbFieldThemeReads', { value: counts.themeReads }))
  app.out(t(locale, 'cli.dbFieldThemeRuns', { value: counts.themeRuns }))
  app.out(t(locale, 'cli.dbFieldNavSnapshots', { value: counts.navSnapshots }))
  app.out(t(locale, 'cli.dbFieldSeriesPoints', { value: counts.seriesPoints }))
  app.out(t(locale, 'cli.dbFieldSeriesProvenance', { value: counts.seriesProvenance }))
  app.out(t(locale, 'cli.dbFieldMacroDocuments', { value: counts.macroDocuments }))
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
  needs: { bootScope: 'persistence', startup: 'none', daemon: 'any', local: true },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language

    if (app.config.storage.engine !== 'sqlite') {
      return usage(app, t(locale, 'cli.dbBackupSqliteOnly'))
    }

    const explicitPath = flagString(args, 'path')
    const explicit = explicitPath === undefined ? undefined : expandHome(explicitPath)

    if (explicit !== undefined && !flagBool(args, 'force') && (await Bun.file(explicit).exists())) {
      return usage(app, t(locale, 'cli.dbBackupTargetExists', { target: explicit }))
    }

    const storage = app.resolve('storage')
    const target =
      explicit === undefined
        ? await backupToDataDir(app, storage, app.resolve('logger'))
        : await backupSqlite(storage, explicit).then(() => explicit)

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

    // Asked before the confirmation, so a mistyped path never reaches the prompt.
    const found = await stat(source).then(
      (info) => info.isFile(),
      () => false
    )

    if (!found) {
      app.err(fail(t(locale, 'cli.dbRestoreSourceMissing', { path: source })))

      return 1
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

    const previous = dataDirBackupTarget(app)

    await restoreSqlite({ dbPath, source, backupPath: previous, logger: silentLogger })
    app.out(success(t(locale, 'cli.dbRestored', { path: dbPath, prev: previous })))

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
    const skipPrompts = flagBool(args, 'yes')

    await backupBeforeReset(app, skipPrompts ? 'assumed' : 'ask')

    if (!(skipPrompts || (await confirm(defaultPrompt(), question, locale)))) {
      return declined(app)
    }

    const applied = await resetPersistence(app.config.storage, silentLogger)

    app.out(
      success(
        t(locale, pluralKey(applied, 'cli.dbResetCompleteOne', 'cli.dbResetComplete'), {
          target,
          count: applied,
        })
      )
    )

    return 0
  },
})

type BackupAnswer = 'ask' | 'assumed'

// Only a sqlite file can be copied here; Postgres is backed up with pg_dump. Opened without
// migrating, so a database too broken to boot can still be saved before it is wiped. `--yes`
// accepts the question's default, which is yes.
async function backupBeforeReset(app: CliApp, answer: BackupAnswer): Promise<void> {
  const locale = app.config.locale.language
  const { storage: config } = app.config

  if (config.engine !== 'sqlite' || !(await Bun.file(config.path).exists())) {
    return
  }

  if (
    answer === 'ask' &&
    !(await confirmDefaultYes(defaultPrompt(), t(locale, 'cli.dbResetBackupFirst'), locale))
  ) {
    return
  }

  const { storage } = await openPersistence(config, silentLogger)

  try {
    const target = await backupToDataDir(app, storage, silentLogger)

    app.out(success(t(locale, 'cli.dbBackedUp', { target })))
  } finally {
    await storage.close()
  }
}

// `db reset` runs without boot, so the logger is passed in rather than resolved.
async function backupToDataDir(app: CliApp, storage: Storage, logger: Logger): Promise<string> {
  const target = dataDirBackupTarget(app)

  await backupAndPrune({ db: storage, target, logger })

  return target
}

function dataDirBackupTarget(app: CliApp): string {
  return backupTarget(join(app.config.paths.dataDir, BACKUPS_SUBDIR))
}

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
