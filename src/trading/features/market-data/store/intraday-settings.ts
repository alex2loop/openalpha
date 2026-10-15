import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'

// The table holds exactly one row: one operator, one switch.
const SETTINGS_ROW_ID = 1

const UPSERT_SQL = 'INSERT INTO intraday_settings (id, disabled_at) VALUES '
const UPSERT_SET = ' ON CONFLICT (id) DO UPDATE SET disabled_at = excluded.disabled_at'

interface SettingsRow {
  readonly disabled_at: number | null
}

interface SetIntradayEnabledOptions {
  readonly enabled: boolean
  readonly now: number
  readonly signal: AbortSignal
}

export interface IntradaySettingsStore {
  /** A missing row is enabled: a fresh install schedules without a seed write. */
  isEnabled(signal: AbortSignal): Promise<boolean>
  setEnabled(options: SetIntradayEnabledOptions): Promise<void>
}

export function createIntradaySettingsStore(deps: StoreDeps): IntradaySettingsStore {
  return {
    isEnabled: (signal) => isEnabled(deps, signal),
    setEnabled: (options) => setEnabled(deps, options),
  }
}

async function isEnabled(deps: StoreDeps, signal: AbortSignal): Promise<boolean> {
  assertNotAborted(signal)

  const rows = await deps.db.query<SettingsRow>(
    `SELECT disabled_at FROM intraday_settings WHERE id = ${deps.dialect.param(1)}`,
    [SETTINGS_ROW_ID]
  )

  return (rows[0]?.disabled_at ?? null) === null
}

async function setEnabled(deps: StoreDeps, options: SetIntradayEnabledOptions): Promise<void> {
  assertNotAborted(options.signal)

  await deps.db.execute(`${UPSERT_SQL}(${deps.dialect.paramList(2)})${UPSERT_SET}`, [
    SETTINGS_ROW_ID,
    options.enabled ? null : options.now,
  ])
}
