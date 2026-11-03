import type { App } from '@/core/container'
import type { UnrecordedSpend, UnrecordedSpendLoad } from '@/engine/api'
import { formatErrForLog } from '@/core/security/credentials'
import { dayBoundsInZone } from '@/core/utils/time'

// The persisted attempt ledger must seed process-local budget enforcement after every restart, plus
// the spend that ledger rejected — otherwise a transient write fault refunds real money at boot.
export async function hydrateCostTracker(app: App): Promise<void> {
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
