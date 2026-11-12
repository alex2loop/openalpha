import type { MigrationDown, MigrationUp } from '@/persistence/types'

// The cap breaches the operator was shown when the order was staged, as a JSON array of breach
// subjects (`position:VNM`), so the confirm refuses a ceiling crossed since rather than one the
// prompt already named. Null on a row staged before this column: no breach is known to have been
// shown, so every one measured at confirm counts as new.
export const up: MigrationUp = async (tx) => {
  await tx.execute('ALTER TABLE order_intents ADD COLUMN shown_breaches TEXT')
}

export const down: MigrationDown = async (tx) => {
  await tx.execute('ALTER TABLE order_intents DROP COLUMN shown_breaches')
}
