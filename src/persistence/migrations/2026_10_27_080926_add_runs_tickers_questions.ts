import type { MigrationDown, MigrationUp } from '@/persistence/types'

// The tickers a run reported on, joined by `,` in the order first seen, and how many of its research
// questions were answered of how many were asked. Null on a row written before they were kept.
export const up: MigrationUp = async (tx) => {
  await tx.execute('ALTER TABLE runs ADD COLUMN tickers TEXT')
  await tx.execute('ALTER TABLE runs ADD COLUMN questions_done INTEGER')
  await tx.execute('ALTER TABLE runs ADD COLUMN questions_total INTEGER')
}

export const down: MigrationDown = async (tx) => {
  await tx.execute('ALTER TABLE runs DROP COLUMN questions_total')
  await tx.execute('ALTER TABLE runs DROP COLUMN questions_done')
  await tx.execute('ALTER TABLE runs DROP COLUMN tickers')
}
