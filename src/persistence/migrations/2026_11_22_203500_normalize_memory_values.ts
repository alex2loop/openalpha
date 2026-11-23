import type { MigrationDown, MigrationUp } from '@/persistence/types'

// Memory values are stored and searched as NFC, but rows written before that rule may hold
// decomposed Vietnamese a composed query never matches. Only a row whose text changes is
// rewritten; the search index follows the value on its own (the sqlite trigger, the postgres
// generated column).
export const up: MigrationUp = async (tx, dialect) => {
  const update =
    `UPDATE memory_kv SET value = ${dialect.param(1)} WHERE agent_id = ${dialect.param(2)} ` +
    `AND user_id = ${dialect.param(3)} AND key = ${dialect.param(4)}`
  const rows = await tx.query<{
    readonly agent_id: string
    readonly user_id: string
    readonly key: string
    readonly value: string
  }>('SELECT agent_id, user_id, key, value FROM memory_kv')

  for (const row of rows) {
    const value = row.value.normalize('NFC')

    if (value !== row.value) {
      await tx.execute(update, [value, row.agent_id, row.user_id, row.key])
    }
  }
}

export const down: MigrationDown = async () => {
  // The previous release reads composed text like any other, so there is nothing to undo.
}
