import type { App } from '@/core/container'
import { hydrateCostTracker } from '@/app/cost-hydration'
import { RUN_LEASE_SLACK_MS } from '@/engine/api'
import { migrateWithBackup } from '@/persistence/node-api'

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
    // Only the daemon notes runs as open, so these are the ones the previous daemon died in.
    await app.resolve('runLogStore').closeOpen()
  }
}

// Idempotent, and the first thing to touch the database: every store below assumes its tables exist.
export async function migrateStartupSchema(app: App): Promise<void> {
  await migrateWithBackup(app.resolve('storage'), app.resolve('dialect'), {
    dataDir: app.config.paths.dataDir,
    logger: app.resolve('logger'),
  })
}
