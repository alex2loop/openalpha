import type { Dialect } from '@/core/types/storage'
import type { RetentionStatement } from '@/persistence/retention-pages'

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

// Read state lives on the row, so an unread notice ages out with the rest: the bell is a recent
// history, not an inbox that must be emptied.
export function countNoticesSql(dialect: Dialect, cutoff: number): RetentionStatement {
  return {
    sql: `SELECT COUNT(*) AS n FROM notices WHERE created_at < ${dialect.param(1)}`,
    params: [cutoff],
  }
}

export function deleteNoticesSql(dialect: Dialect, cutoff: number): RetentionStatement {
  return {
    sql: `DELETE FROM notices WHERE created_at < ${dialect.param(1)}`,
    params: [cutoff],
  }
}
