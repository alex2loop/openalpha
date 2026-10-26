import type { Dialect } from '@/core/types/storage'

// Seeded from the asked ids and walked down both records of who started whom: `runs.parent_run_id`
// (a command or an agent with no attempt of its own still carries its children) and
// `llm_attempts.parent_run_id` (a read billed under a throwaway run id, which has no `runs` row,
// still counts for the run that asked). `edges` is one non-recursive CTE so the recursive term
// names `tree` once, which Postgres requires. UNION keeps one (root, run_id) pair however a tree
// is shaped, so a join to the attempts counts each attempt once per root, and a cycle ends. The
// seed column is cast because an untyped bind in VALUES has no type to resolve against on Postgres.
// The caller binds the `count` seed ids first and ends its query on `tree(root, run_id)`.
export function runTreeCtes(d: Dialect, count: number): string {
  const seeds = Array.from({ length: count }, (_, i) => `(CAST(${d.param(i + 1)} AS TEXT))`)

  return (
    `WITH RECURSIVE seeds(id) AS (VALUES ${seeds.join(', ')}), ` +
    `edges(run_id, parent_run_id) AS (` +
    `SELECT run_id, parent_run_id FROM runs WHERE parent_run_id IS NOT NULL ` +
    `UNION ` +
    `SELECT run_id, parent_run_id FROM llm_attempts WHERE parent_run_id IS NOT NULL), ` +
    `tree(root, run_id) AS (` +
    `SELECT id, id FROM seeds ` +
    `UNION ` +
    `SELECT t.root, e.run_id FROM tree t JOIN edges e ON e.parent_run_id = t.run_id) `
  )
}
