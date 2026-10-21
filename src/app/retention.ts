import { join } from 'node:path'

import type { App } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { WorkspaceCleanupResult } from '@/engine/api'
import { pruneRemovedAgentLogs } from '@/core/logging/retention'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_DAY, MS_PER_HOUR } from '@/core/utils/time'
import { pruneExpiredWorkspaceTmp } from '@/engine/api'
import {
  BACKUPS_SUBDIR,
  backupAndPrune,
  backupTarget,
  newestBackupAt,
  optimizeSqlite,
  runRetention,
} from '@/persistence/api'

const RETENTION_INTERVAL_MS = 6 * MS_PER_HOUR
const DAILY_BACKUPS_SUBDIR = 'daily'

/** Sweeps every retention scope now and then every few hours; the returned stop waits out a sweep
 *  in flight. */
export function startRetention(app: App, logger: Logger): () => Promise<void> {
  const configuredAgentIds = Object.freeze(new Set(app.resolve('agents').keys()))
  let inFlight: Promise<void> | null = null

  const sweep = (): void => {
    if (inFlight !== null) {
      return
    }

    inFlight = runRetentionSweep(app, logger, configuredAgentIds)
      .catch((err: unknown) => {
        logger.warn('retention.failed', { err: formatErrForLog(err) })
      })
      .finally(() => {
        inFlight = null
      })
  }

  const timer = setInterval(sweep, RETENTION_INTERVAL_MS)
  // A pruning sweep is never worth holding the process open for.
  timer.unref()
  // Run the first sweep immediately so a long-lived daemon does not wait a full interval
  // before reclaiming anything created while it was down.
  sweep()

  return async () => {
    clearInterval(timer)
    if (inFlight !== null) {
      await inFlight
    }
  }
}

async function runRetentionSweep(
  app: App,
  logger: Logger,
  configuredAgentIds: ReadonlySet<string>
): Promise<void> {
  const cutoffAt = retentionCutoffAt(app)

  await runRetention(app.resolve('storage'), app.resolve('dialect'), {
    config: {
      retentionDays: app.config.retention.days,
      inboxRetentionDays: app.config.retention.inboxDays,
    },
    logger,
  }).catch((err: unknown) => {
    logger.warn('retention.database_failed', { err: formatErrForLog(err) })
  })

  await runWorkspaceTmpRetention(app, logger, cutoffAt)

  const logResult = await pruneRemovedAgentLogs({
    dataDir: app.config.paths.dataDir,
    configuredAgentIds,
    cutoffAt,
  }).catch((err: unknown) => {
    logger.warn('retention.agent_logs_failed', { err: formatErrForLog(err) })
    return undefined
  })

  if (logResult !== undefined) {
    logger.info('retention.agent_logs', {
      removedDirectories: logResult.removedDirectories,
      removedBytes: logResult.removedBytes,
      failures: logResult.failures,
    })
  }

  await backupDaily(app, logger)
  await optimizeDatabase(app, logger)
}

// The sweep is the schedule: it runs every RETENTION_INTERVAL_MS. No engine timer, so there is nothing
// to leak through a closed handle, and short commands do not pay for it.
async function optimizeDatabase(app: App, logger: Logger): Promise<void> {
  if (app.config.storage.engine !== 'sqlite') {
    return
  }

  try {
    await optimizeSqlite(app.resolve('storage'))
  } catch (err: unknown) {
    logger.warn('retention.optimize_failed', { err: formatErrForLog(err) })
  }
}

// The margin keeps a sweep every RETENTION_INTERVAL_MS from sliding the copy to one every
// MS_PER_DAY + RETENTION_INTERVAL_MS: copies land 18 to 24 hours apart.
async function backupDaily(app: App, logger: Logger): Promise<void> {
  const { storage, retention, paths } = app.config

  if (storage.engine !== 'sqlite' || retention.dailyBackups === 0) {
    return
  }

  const dir = join(paths.dataDir, BACKUPS_SUBDIR, DAILY_BACKUPS_SUBDIR)

  try {
    if (!isBackupDue(await newestBackupAt(dir), Date.now())) {
      return
    }

    const target = backupTarget(dir)

    await backupAndPrune({
      db: app.resolve('storage'),
      target,
      logger,
      keep: retention.dailyBackups,
    })
    logger.info('retention.backup_taken', { path: target })
  } catch (err: unknown) {
    logger.warn('retention.backup_failed', { err: formatErrForLog(err) })
  }
}

function isBackupDue(newestAt: number | null, now: number): boolean {
  return newestAt === null || newestAt > now || now - newestAt >= MS_PER_DAY - RETENTION_INTERVAL_MS
}

export function retentionCutoffAt(app: App): number {
  return Date.now() - app.config.retention.days * MS_PER_DAY
}

export async function runWorkspaceTmpRetention(
  app: App,
  logger: Logger,
  cutoffAt: number
): Promise<void> {
  try {
    const result = await pruneExpiredWorkspaceTmp({
      dataDir: app.config.paths.dataDir,
      cutoffAt,
    })
    const summary = summarizeWorkspaceResult(result)

    logger.info('workspace.tmp_retention', summary)
  } catch (err: unknown) {
    logger.warn('workspace.tmp_retention_failed', { err: formatErrForLog(err) })
  }
}

function summarizeWorkspaceResult(result: WorkspaceCleanupResult): {
  readonly removedFiles: number
  readonly removedBytes: number
  readonly failures: number
} {
  let removedFiles = 0
  let removedBytes = 0
  let failures = 0

  for (const agent of result.agents.values()) {
    removedFiles += agent.removedFiles
    removedBytes += agent.removedBytes
    failures += agent.failures
  }

  return { removedFiles, removedBytes, failures }
}
