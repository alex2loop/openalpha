import type { Dialect, Storage, Transaction } from '@/core/types/storage'
import type { RetentionStatement } from '@/persistence/retention-pages'
import { olderSuggestionsSql, SUGGESTIONS_KEEP_PER_NAME } from '@/persistence/retention-history'
import { buildPageCount, countRows, drainPages } from '@/persistence/retention-pages'
import { dbTable } from '@/persistence/tables'

/** A page is read whole into memory, and one old row's factor stamps ran past 160 KB. */
const EVIDENCE_TRIM_LIMIT = 200

// The track record reads each factor's id, score and weight, never its source stamps, and the
// suggestion keeps the union of those stamps at its top level. So a scored call past the general
// window keeps its factors with their stamps emptied, and still parses: an empty list is a list.
export function evidenceFilter(dialect: Dialect, cutoff: number): RetentionStatement {
  const before = dialect.param(2)

  return {
    sql:
      `id IN (${olderSuggestionsSql(dialect.param(1))} AND ranked.resolved_at < ${before}) ` +
      `AND outcome_status IS NOT NULL AND ${factorStampsWhere(dialect)}`,
    params: [SUGGESTIONS_KEEP_PER_NAME, cutoff],
  }
}

export async function countEvidence(tx: Transaction, filter: RetentionStatement): Promise<number> {
  const { sql, params } = buildPageCount(dbTable('suggestions'), filter)

  return countRows(tx, sql, params)
}

/** A trimmed row no longer matches the filter, so a second sweep reads past it. */
export function trimEvidence(
  db: Storage,
  dialect: Dialect,
  filter: RetentionStatement
): Promise<number> {
  const limit = dialect.param(filter.params.length + 1)
  const select = `SELECT id, payload FROM suggestions WHERE ${filter.sql} ORDER BY id LIMIT ${limit}`
  const update = `UPDATE suggestions SET payload = ${dialect.param(1)} WHERE id = ${dialect.param(2)}`

  return drainPages(
    () =>
      db.transaction(async (tx) => {
        const rows = await tx.query<{ readonly id: string; readonly payload: string }>(select, [
          ...filter.params,
          EVIDENCE_TRIM_LIMIT,
        ])

        for (const row of rows) {
          await tx.execute(update, [withoutFactorStamps(row.payload), row.id])
        }

        return rows.length
      }),
    EVIDENCE_TRIM_LIMIT
  )
}

function factorStampsWhere(dialect: Dialect): string {
  if (dialect.name === 'postgres') {
    return (
      "EXISTS (SELECT 1 FROM jsonb_array_elements(payload::jsonb -> 'factorScores') factor " +
      "WHERE jsonb_array_length(factor -> 'provenance') > 0)"
    )
  }

  return (
    "EXISTS (SELECT 1 FROM json_each(payload, '$.factorScores') factor " +
    "WHERE json_array_length(factor.value, '$.provenance') > 0)"
  )
}

// Raw JSON, not the payload schema: a key this build does not know is written back as it was.
function withoutFactorStamps(payload: string): string {
  const parsed = JSON.parse(payload) as { readonly factorScores: readonly object[] }

  return JSON.stringify({
    ...parsed,
    factorScores: parsed.factorScores.map((factor) => ({ ...factor, provenance: [] })),
  })
}
