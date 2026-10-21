import type { MigrationDown, MigrationUp } from '@/persistence/types'

export const up: MigrationUp = async (tx) => {
  await tx.execute('ALTER TABLE quarterly_accounts ADD COLUMN cash_flow_source_id TEXT')
}

// The next refresh refetches the deleted quarters from the primary provider.
export const down: MigrationDown = async (tx) => {
  await tx.execute('DELETE FROM quarterly_accounts WHERE cash_flow_source_id IS NOT NULL')
  await tx.execute('ALTER TABLE quarterly_accounts DROP COLUMN cash_flow_source_id')
}
