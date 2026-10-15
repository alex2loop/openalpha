import type { MigrationDown, MigrationUp } from '@/persistence/types'

export const up: MigrationUp = async (tx) => {
  await tx.execute('ALTER TABLE channel_inbox ADD COLUMN retry_at BIGINT')
}

export const down: MigrationDown = async (tx) => {
  await tx.execute('ALTER TABLE channel_inbox DROP COLUMN retry_at')
}
