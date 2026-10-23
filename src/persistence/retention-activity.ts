import type { Dialect } from '@/core/types/storage'

/** A statement and its binds, run by the sweep in `retention.ts`. */
interface RetentionStatement {
  readonly sql: string
  readonly params: readonly unknown[]
}

// The run log is history the daemon wrote about itself, so it ages out with the general window. The
// attempt ledger that prices each run is not touched here: it keeps its own, longer window.
export function countRunsSql(dialect: Dialect, cutoff: number): RetentionStatement {
  return {
    sql: `SELECT COUNT(*) AS n FROM runs WHERE ended_at < ${dialect.param(1)}`,
    params: [cutoff],
  }
}

export function deleteRunsSql(dialect: Dialect, cutoff: number): RetentionStatement {
  return {
    sql: `DELETE FROM runs WHERE ended_at < ${dialect.param(1)}`,
    params: [cutoff],
  }
}
