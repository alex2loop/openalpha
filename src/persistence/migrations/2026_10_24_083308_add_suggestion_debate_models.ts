import type { MigrationDown, MigrationUp } from '@/persistence/types'

// The sorted model list that argued the call, joined by `,`. Null on a row written before it was
// kept, which no per-model count reads.
export const up: MigrationUp = async (tx) => {
  await tx.execute('ALTER TABLE suggestions ADD COLUMN debate_models TEXT')
}

export const down: MigrationDown = async (tx) => {
  await tx.execute('ALTER TABLE suggestions DROP COLUMN debate_models')
}
