import { join } from 'node:path'

import type { App } from '@/core/container'
import type { UnrecordedSpend, UnrecordedSpendLoad } from '@/engine/api'
import { formatErrForLog } from '@/core/security/credentials'
import { dayBoundsInZone } from '@/core/utils/time'
import { RUN_LEASE_SLACK_MS } from '@/engine/api'
import { BACKUPS_SUBDIR, migrate } from '@/persistence/api'

export async function hydrateStartupState(app: App, mode: 'cli' | 'daemon'): Promise<void> {
  await migrateStartupSchema(app)
  await hydrateCostTracker(app)

  if (mode === 'daemon') {
    // A previous process died mid-run; a session nobody has touched within its lease is nobody's
    // work now. One a live CLI run is still renewing stays its.
    const now = Date.now()

    await app
      .resolve('sessionStore')
      .markStaleRuns(now - (app.config.loop.maxDurationMs + RUN_LEASE_SLACK_MS))
  }
}

// Idempotent, and the first thing to touch the database: every store below assumes its tables exist.
export async function migrateStartupSchema(app: App): Promise<void> {
  await migrate(app.resolve('storage'), app.resolve('dialect'), {
    backupDir: join(app.config.paths.dataDir, BACKUPS_SUBDIR),
    logger: app.resolve('logger'),
  })
}

// The persisted attempt ledger must seed process-local budget enforcement after every restart, plus
// the spend that ledger rejected — otherwise a transient write fault refunds real money at boot.
async function hydrateCostTracker(app: App): Promise<void> {
  const store = app.resolve('llmAttemptStore')
  const now = Date.now()
  const [daily, monthly, unrecorded] = await Promise.all([
    store.totalFor('day', now),
    store.totalFor('month', now),
    reconcileUnrecordedSpend(app, now),
  ])
  // The window `totalFor('day')` and the cap already use: a UTC day would refund the first hours of
  // a UTC+7 day at every restart.
  const today = dayBoundsInZone(now, app.config.locale.timezone)

  app.resolve('costTracker').hydrate({
    dayUsd:
      daily +
      sumUsd(
        unrecorded.filter(
          (entry) => entry.settledAt >= today.fromMs && entry.settledAt < today.toMs
        )
      ),
    monthUsd: monthly + sumUsd(unrecorded),
    at: now,
  })
}

// An attempt can be in both ledgers: the last retry may have committed and lost only its
// acknowledgement. The store's totals already count those, so only the truly missing ones are added.
async function reconcileUnrecordedSpend(
  app: App,
  now: number
): Promise<readonly UnrecordedSpend[]> {
  const { entries, damaged, path } = await loadUnrecordedSpend(app, now)

  if (damaged) {
    // The unreadable line stays on disk, so every boot blocks until an operator resolves it —
    // repairing it here would trade a known gap for a silent one.
    app.resolve('costTracker').markLedgerUnavailable()
    app.resolve('logger').error('budget.unrecorded_spend_damaged', { path })
  }

  const recorded = await app
    .resolve('llmAttemptStore')
    .recordedIds(entries.map((entry) => entry.id))

  return entries.filter((entry) => !recorded.has(entry.id))
}

async function loadUnrecordedSpend(app: App, now: number): Promise<UnrecordedSpendLoad> {
  try {
    return await app.resolve('unrecordedSpend').load(now)
  } catch (err: unknown) {
    // Unknown past spend cannot be proven under a cap, so admit no paid work until it is readable.
    app.resolve('costTracker').markLedgerUnavailable()
    app.resolve('logger').error('budget.unrecorded_spend_unreadable', { err: formatErrForLog(err) })

    return { entries: [], damaged: false, path: '' }
  }
}

function sumUsd(entries: readonly UnrecordedSpend[]): number {
  return entries.reduce((total, entry) => total + entry.costUsd, 0)
}
