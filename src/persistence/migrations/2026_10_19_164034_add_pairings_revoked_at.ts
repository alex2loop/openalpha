import type { MigrationDown, MigrationUp } from '@/persistence/types'

export const up: MigrationUp = async (tx) => {
  await tx.execute('ALTER TABLE pairings ADD COLUMN revoked_at BIGINT')
}

// A revoked row would read as approved again without the column, so it goes first: rolling back
// must not hand a revoked chat its access back.
export const down: MigrationDown = async (tx) => {
  await tx.execute('DELETE FROM pairings WHERE revoked_at IS NOT NULL')
  await tx.execute('ALTER TABLE pairings DROP COLUMN revoked_at')
}
