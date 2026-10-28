import type { Dialect } from '@/core/types/storage'

// Both records of who started whom: `runs.parent_run_id` (a command or an agent with no attempt of
// its own still carries its children) and `llm_attempts.parent_run_id` (a read billed under a
// throwaway run id, which has no `runs` row, still counts for the run that asked). `edges` is one
// non-recursive CTE so a recursive term names its own CTE once, which Postgres requires.
const RUN_EDGES_CTE =
  `edges(run_id, parent_run_id) AS (` +
  `SELECT run_id, parent_run_id FROM runs WHERE parent_run_id IS NOT NULL ` +
  `UNION ` +
  `SELECT run_id, parent_run_id FROM llm_attempts WHERE parent_run_id IS NOT NULL)`

// Seeded from the asked ids and walked down the edges. UNION keeps one (root, run_id) pair however
// a tree is shaped, so a join to the attempts counts each attempt once per root, and a cycle ends.
// The seed column is cast because an untyped bind in VALUES has no type to resolve against on
// Postgres. The caller binds the `count` seed ids first and ends its query on `tree(root, run_id)`.
export function runTreeCtes(d: Dialect, count: number): string {
  const seeds = Array.from({ length: count }, (_, i) => `(CAST(${d.param(i + 1)} AS TEXT))`)

  return (
    `WITH RECURSIVE seeds(id) AS (VALUES ${seeds.join(', ')}), ` +
    `${RUN_EDGES_CTE}, ` +
    `tree(root, run_id) AS (` +
    `SELECT id, id FROM seeds ` +
    `UNION ` +
    `SELECT t.root, e.run_id FROM tree t JOIN edges e ON e.parent_run_id = t.run_id) `
  )
}

// Seeded from the runs billed in `[param 1, param 2)` of `settled_at` and walked up the edges.
// A run's root is its ancestor with no parent; where two parents disagree the smaller root id
// wins, so every run has at most one root. A run on a cycle has none: the caller reads it as
// rootless. The caller binds the window first and ends its query on `roots(run_id, root)`.
export function runRootCtes(d: Dialect): string {
  return (
    `WITH RECURSIVE billed(run_id) AS (SELECT DISTINCT run_id FROM llm_attempts ` +
    `WHERE settled_at >= ${d.param(1)} AND settled_at < ${d.param(2)}), ` +
    `${RUN_EDGES_CTE}, ` +
    `walk(run_id, ancestor) AS (` +
    `SELECT run_id, run_id FROM billed ` +
    `UNION ` +
    `SELECT w.run_id, e.parent_run_id FROM walk w JOIN edges e ON e.run_id = w.ancestor), ` +
    `roots(run_id, root) AS (SELECT run_id, MIN(ancestor) FROM walk w ` +
    `WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.run_id = w.ancestor) GROUP BY run_id) `
  )
}
