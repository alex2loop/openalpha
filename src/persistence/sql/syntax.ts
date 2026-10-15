// Only clauses that are byte-identical across engines belong here — an engine owns its own
// placeholder form and Dialect — so adding an engine never edits this file.

import type { InsertTarget, UpsertTarget } from '@/core/types/storage'

/** SQLite's default bind ceiling. Postgres allows more, but one shared chunk size keeps the two
 *  engines writing identical statement counts, which is what makes a slow write reproducible. */
export const SQL_MAX_BIND_PARAMS = 900

type Param = (index: number) => string

/** Rows per statement for a batched write: as many as the engine's bind ceiling admits, so a write
 *  costs one round trip per chunk rather than one per row. At least one, so a table wider than the
 *  ceiling still writes a row at a time instead of none. */
export function bindChunkSize(columnCount: number): number {
  return Math.max(1, Math.floor(SQL_MAX_BIND_PARAMS / columnCount))
}

export function paramList(param: Param, count: number, startAt = 1): string {
  return Array.from({ length: count }, (_, i) => param(startAt + i)).join(', ')
}

// A CHECK value list interpolated from a contract tuple so TypeScript and database validation
// cannot drift. Called only with boot-time constant arrays, never with request data; the quote
// doubling is defense in depth for the day a contract value contains an apostrophe.
export function sqlTextValues(values: readonly string[]): string {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(',')
}

export function buildStateCheck(column: string, states: readonly string[]): string {
  return `${column} TEXT NOT NULL CHECK (${column} IN (${sqlTextValues(states)}))`
}

// Upsert-replace, except for `keepWhenNull` columns, where a NULL leaves the stored value standing.
// Callers bind [...keys, ...cols] values in exactly that order, once per row. Accumulating columns
// need upsert-increment instead.
export function buildUpsert(param: Param, table: string, target: UpsertTarget): string {
  const { keys, cols } = target
  const allCols = [...keys, ...cols]
  const kept = new Set(target.keepWhenNull ?? [])
  const setClause = cols
    .map((c) =>
      kept.has(c) ? `${c} = COALESCE(excluded.${c}, ${table}.${c})` : `${c} = excluded.${c}`
    )
    .join(', ')

  return (
    `INSERT INTO ${table} (${allCols.join(', ')}) ` +
    `VALUES ${valuesClause(param, allCols.length, target.rowCount)} ` +
    `ON CONFLICT (${keys.join(', ')}) DO UPDATE SET ${setClause}`
  )
}

export function buildInsert(param: Param, table: string, target: InsertTarget): string {
  const { cols } = target

  return (
    `INSERT INTO ${table} (${cols.join(', ')}) ` +
    `VALUES ${valuesClause(param, cols.length, target.rowCount)}`
  )
}

function valuesClause(param: Param, columnCount: number, rowCount: number): string {
  return Array.from(
    { length: rowCount },
    (_, row) => `(${paramList(param, columnCount, row * columnCount + 1)})`
  ).join(', ')
}
