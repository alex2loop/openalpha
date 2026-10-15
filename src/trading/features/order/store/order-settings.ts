import type { HaltInput } from '@/trading/features/order/types'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'

const SETTINGS_ROW_ID = 1

const UPSERT_SQL = 'INSERT INTO order_settings (id, halted_at) VALUES '
const UPSERT_SET = ' ON CONFLICT (id) DO UPDATE SET halted_at = excluded.halted_at'

interface SettingsRow {
  readonly halted_at: number | null
}

export interface OrderSettingsStore {
  /** A missing row is buying as usual. */
  haltedAt(signal: AbortSignal): Promise<number | undefined>
  setHalted(input: HaltInput): Promise<void>
}

export function createOrderSettingsStore(deps: StoreDeps): OrderSettingsStore {
  return {
    haltedAt: (signal) => haltedAt(deps, signal),
    setHalted: (input) => setHalted(deps, input),
  }
}

async function haltedAt(deps: StoreDeps, signal: AbortSignal): Promise<number | undefined> {
  assertNotAborted(signal)

  const rows = await deps.db.query<SettingsRow>(
    `SELECT halted_at FROM order_settings WHERE id = ${deps.dialect.param(1)}`,
    [SETTINGS_ROW_ID]
  )

  return rows[0]?.halted_at ?? undefined
}

async function setHalted(deps: StoreDeps, input: HaltInput): Promise<void> {
  assertNotAborted(input.signal)

  await deps.db.execute(`${UPSERT_SQL}(${deps.dialect.paramList(2)})${UPSERT_SET}`, [
    SETTINGS_ROW_ID,
    input.halted ? input.now : null,
  ])
}
