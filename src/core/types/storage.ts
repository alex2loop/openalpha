export interface Transaction {
  query<T>(sql: string, params?: readonly unknown[]): Promise<readonly T[]>
  execute(sql: string, params?: readonly unknown[]): Promise<{ readonly changes: number }>
}

export interface Storage {
  query<T>(sql: string, params?: readonly unknown[]): Promise<readonly T[]>
  execute(sql: string, params?: readonly unknown[]): Promise<{ readonly changes: number }>
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>
  close(): Promise<void>
}
export type DialectName = 'sqlite' | 'postgres'

// Consumer-side interface for writing portable SQL: each module holding a Storage also needs the
// placeholder/upsert syntax for its dialect. persistence provides the sqlite/postgres impls.
/** One statement's worth of rows for a batched write. The caller binds each row's
 *  `[...keys, ...cols]` values in that order, row after row. */
export interface UpsertTarget {
  readonly keys: readonly string[]
  readonly cols: readonly string[]
  readonly rowCount: number
  /** Columns a NULL must not overwrite, for a row several providers each fill part of: a provider
   *  that published nothing must not erase what another one published. Absent means replace. */
  readonly keepWhenNull?: readonly string[]
}

/** An insert that follows its own delete, so it needs no conflict clause. Values bind in column
 *  order, row after row. */
export interface InsertTarget {
  readonly cols: readonly string[]
  readonly rowCount: number
}

export interface Dialect {
  readonly name: DialectName
  readonly autoIncrementPk: string
  // One placeholder at 1-based position `index`: sqlite `?`, postgres `$index`.
  param(index: number): string
  // `count` comma-joined placeholders for a VALUES tuple or an IN-list, starting at 1-based
  // position `startAt` (default 1) so a caller with already-bound params continues the sequence
  // without a hand-counted offset.
  paramList(count: number, startAt?: number): string
  upsert(table: string, target: UpsertTarget): string
  insert(table: string, target: InsertTarget): string
}
export interface FtsHit {
  readonly key: string
  readonly value: string
  readonly rank: number
}

export interface FtsScope {
  readonly agentId: string
  readonly userId: string
  readonly keyPrefix?: string
}

export interface FtsSearch {
  search(scope: FtsScope, query: string, limit: number): Promise<readonly FtsHit[]>
}
