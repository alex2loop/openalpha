import type { Dialect, Transaction } from '@/core/types/storage'
import type { DbTable } from '@/persistence/tables'

/** Deletes go in bounded pages so one long-neglected table cannot hold a write lock for the whole
 *  sweep. */
export const RETENTION_DELETE_LIMIT = 5_000
/** Bounds one sweep so a very large backlog cannot hold the write lock for an unbounded time. */
const RETENTION_MAX_PASSES = 20
const SQLITE_DIRECT_CHANGES_SQL = 'SELECT changes() AS n'

/** A statement and its binds, run by the sweep in `retention.ts`. */
export interface RetentionStatement {
  readonly sql: string
  readonly params: readonly unknown[]
}

/** A short page means the scope is drained; a full one means there is more behind it. */
export async function drainPages(
  deletePage: () => Promise<number>,
  limit: number = RETENTION_DELETE_LIMIT
): Promise<number> {
  let deleted = 0

  for (let pass = 0; pass < RETENTION_MAX_PASSES; pass += 1) {
    const page = await deletePage()

    deleted += page

    if (page < limit) {
      break
    }
  }

  return deleted
}

/** How many rows `filter` matches. */
export function buildPageCount(table: DbTable, filter: RetentionStatement): RetentionStatement {
  return {
    sql: `SELECT COUNT(*) AS n FROM ${table.name} WHERE ${filter.sql}`,
    params: filter.params,
  }
}

/** One page of the rows `filter` matches, addressed by the table's registered primary key. The limit
 *  binds after the filter's own params. */
export function buildPageDelete(
  dialect: Dialect,
  table: DbTable,
  filter: RetentionStatement
): RetentionStatement {
  const keys = table.pk.join(', ')
  const key = table.pk.length === 1 ? keys : `(${keys})`
  const limit = dialect.param(filter.params.length + 1)

  return {
    sql:
      `DELETE FROM ${table.name} WHERE ${key} IN (` +
      `SELECT ${keys} FROM ${table.name} WHERE ${filter.sql} LIMIT ${limit})`,
    params: [...filter.params, RETENTION_DELETE_LIMIT],
  }
}

export async function deleteCount(
  tx: Transaction,
  dialect: Dialect,
  statement: RetentionStatement
): Promise<number> {
  const result = await tx.execute(statement.sql, statement.params)

  if (dialect.name === 'postgres') {
    return result.changes
  }

  // Bun includes trigger and foreign-key side effects; changes() reports only the direct rows.
  return countRows(tx, SQLITE_DIRECT_CHANGES_SQL)
}

export async function countRows(
  tx: Transaction,
  sql: string,
  params?: readonly unknown[]
): Promise<number> {
  const rows = await tx.query<{ readonly n: number }>(sql, params)
  return rows[0]?.n ?? 0
}
