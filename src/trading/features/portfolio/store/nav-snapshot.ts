import type { NavSnapshot, NavSnapshotStore } from '@/trading/features/portfolio/nav/types'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { currencyCode, tradingDay } from '@/trading/kernel/instrument'

const SNAPSHOT_KEYS = ['day']
const SNAPSHOT_COLS = ['base_currency', 'nav_base', 'cash_base', 'net_deposits_base', 'recorded_at']

interface SnapshotRow {
  readonly day: string
  readonly base_currency: string
  readonly nav_base: number
  readonly cash_base: number
  readonly net_deposits_base: number
  readonly recorded_at: number
}

function toSnapshot(row: SnapshotRow): NavSnapshot {
  return {
    day: tradingDay(row.day),
    baseCurrency: currencyCode(row.base_currency),
    navBase: row.nav_base,
    cashBase: row.cash_base,
    netDepositsBase: row.net_deposits_base,
    recordedAt: row.recorded_at,
  }
}

export function createNavSnapshotStore(deps: StoreDeps): NavSnapshotStore {
  return {
    async upsert(snapshot, signal) {
      assertNotAborted(signal)

      const sql = deps.dialect.upsert('nav_snapshots', {
        keys: SNAPSHOT_KEYS,
        cols: SNAPSHOT_COLS,
        rowCount: 1,
      })

      await deps.db.execute(sql, [
        snapshot.day,
        snapshot.baseCurrency,
        snapshot.navBase,
        snapshot.cashBase,
        snapshot.netDepositsBase,
        snapshot.recordedAt,
      ])
    },

    async list(options) {
      assertNotAborted(options.signal)

      const rows = await deps.db.query<SnapshotRow>(
        `SELECT * FROM nav_snapshots WHERE base_currency = ${deps.dialect.param(1)} ORDER BY day`,
        [options.baseCurrency]
      )

      return rows.map(toSnapshot)
    },
  }
}
