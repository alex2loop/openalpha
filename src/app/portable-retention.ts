import type { App } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_HOUR } from '@/core/utils/time'
import { runRetention } from '@/persistence/api'
import { HISTORY_FLOOR_DAYS } from '@/trading/api'

export const RETENTION_INTERVAL_MS = 6 * MS_PER_HOUR

/** The part of a retention sweep that needs only the database: what the daemon and the browser both
 *  run. A failure is logged and never thrown, so the rest of a sweep still runs. */
export async function runPortableRetention(app: App, logger: Logger): Promise<void> {
  await runRetention(app.resolve('storage'), app.resolve('dialect'), {
    config: {
      retentionDays: app.config.retention.days,
      historyRetentionDays: app.config.retention.historyDays,
      inboxRetentionDays: app.config.retention.inboxDays,
      historyFloors: HISTORY_FLOOR_DAYS,
    },
    logger,
  }).catch((err: unknown) => {
    logger.warn('retention.database_failed', { err: formatErrForLog(err) })
  })
}
