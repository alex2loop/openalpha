import type { RunId } from '@/core/ids'
import type { Dialect, Storage } from '@/core/types/storage'
import type { RunLogRow, RunLogStore } from '@/persistence/types'
import { channelId } from '@/core/channels'
import { agentId, runId, sessionId } from '@/core/ids'
import { fromNanoUsd } from '@/persistence/money'
import { SQL_MAX_BIND_PARAMS } from '@/persistence/sql/syntax'

/** The built-in research agent's id (`DEEP_RESEARCHER_ID` in engine, which persistence cannot
 *  import): the agent whose top-level runs the research page lists. */
const RESEARCH_AGENT_NAME = 'deep-researcher'

const RUN_COLUMNS = [
  'run_id',
  'kind',
  'name',
  'title',
  'summary',
  'agent_id',
  'channel',
  'chat_id',
  'session_id',
  'parent_run_id',
  'sources',
  'started_at',
  'ended_at',
  'outcome',
] as const

interface DbRunRow {
  readonly run_id: string
  readonly kind: 'agent' | 'command'
  readonly name: string
  readonly title: string | null
  readonly summary: string | null
  readonly agent_id: string | null
  readonly channel: string | null
  readonly chat_id: string | null
  readonly session_id: string | null
  readonly parent_run_id: string | null
  readonly sources: number | null
  readonly started_at: number
  readonly ended_at: number
  readonly outcome: string
}

export function createRunLogStore(db: Storage, dialect: Dialect): RunLogStore {
  const sql = buildSql(dialect)

  return {
    record: async (row) => {
      await db.execute(sql.insert, toParams(row))
    },
    listTopLevel: async (fromMs, toMs, limit) =>
      (await db.query<DbRunRow>(sql.topLevel, [fromMs, toMs, limit])).map(toRunLogRow),
    listResearch: async (beforeMs, limit) =>
      (await db.query<DbRunRow>(sql.research, [RESEARCH_AGENT_NAME, beforeMs, limit])).map(
        toRunLogRow
      ),
    childrenOf: (ids, perRun) => childrenOf({ db, dialect }, ids, perRun),
    costOf: (ids) => costOf({ db, dialect }, ids),
  }
}

interface StoreDeps {
  readonly db: Storage
  readonly dialect: Dialect
}

async function childrenOf(
  { db, dialect }: StoreDeps,
  ids: readonly string[],
  perRun: number
): Promise<ReadonlyMap<RunId, readonly RunLogRow[]>> {
  const children = new Map<RunId, RunLogRow[]>()

  // One bind is the per-run cap, so a chunk holds one fewer id than the ceiling.
  for (const chunk of chunked(ids, SQL_MAX_BIND_PARAMS - 1)) {
    const rows = await db.query<DbRunRow>(buildChildrenSql(dialect, chunk.length), [
      ...chunk,
      perRun,
    ])

    for (const row of rows.map(toRunLogRow)) {
      const parent = row.parentRunId

      if (parent !== undefined) {
        children.set(parent, [...(children.get(parent) ?? []), row])
      }
    }
  }

  return children
}

async function costOf(
  { db, dialect }: StoreDeps,
  ids: readonly string[]
): Promise<ReadonlyMap<RunId, number>> {
  const costs = new Map<RunId, number>()

  for (const chunk of chunked(ids, SQL_MAX_BIND_PARAMS)) {
    const rows = await db.query<{ readonly root: string; readonly total: number }>(
      buildCostSql(dialect, chunk.length),
      [...chunk]
    )

    for (const row of rows) {
      costs.set(runId(row.root), fromNanoUsd(row.total))
    }
  }

  return costs
}

function chunked<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const chunks: (readonly T[])[] = []

  for (let at = 0; at < items.length; at += size) {
    chunks.push(items.slice(at, at + size))
  }

  return chunks
}

function toRunLogRow(row: DbRunRow): RunLogRow {
  return {
    runId: runId(row.run_id),
    kind: row.kind,
    name: row.name,
    ...(row.title === null ? {} : { title: row.title }),
    ...(row.summary === null ? {} : { summary: row.summary }),
    ...(row.agent_id === null ? {} : { agentId: agentId(row.agent_id) }),
    ...(row.channel === null ? {} : { channel: channelId(row.channel) }),
    ...(row.chat_id === null ? {} : { chatId: row.chat_id }),
    ...(row.session_id === null ? {} : { sessionId: sessionId(row.session_id) }),
    ...(row.parent_run_id === null ? {} : { parentRunId: runId(row.parent_run_id) }),
    ...(row.sources === null ? {} : { sources: row.sources }),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    outcome: row.outcome,
  }
}

function toParams(row: RunLogRow): readonly unknown[] {
  return [
    row.runId,
    row.kind,
    row.name,
    row.title ?? null,
    row.summary ?? null,
    row.agentId ?? null,
    row.channel ?? null,
    row.chatId ?? null,
    row.sessionId ?? null,
    row.parentRunId ?? null,
    row.sources ?? null,
    row.startedAt,
    row.endedAt,
    row.outcome,
  ]
}

function buildSql(d: Dialect) {
  const columns = RUN_COLUMNS.join(', ')

  return {
    insert:
      `INSERT INTO runs (${columns}) VALUES (${d.paramList(RUN_COLUMNS.length)}) ` +
      `ON CONFLICT (run_id) DO NOTHING`,
    topLevel:
      `SELECT ${columns} FROM runs WHERE parent_run_id IS NULL ` +
      `AND ended_at >= ${d.param(1)} AND ended_at < ${d.param(2)} ` +
      `ORDER BY ended_at DESC, run_id DESC LIMIT ${d.param(3)}`,
    research:
      `SELECT ${columns} FROM runs WHERE parent_run_id IS NULL AND kind = 'agent' ` +
      `AND name = ${d.param(1)} AND ended_at < ${d.param(2)} ` +
      `ORDER BY ended_at DESC, run_id DESC LIMIT ${d.param(3)}`,
  }
}

function buildChildrenSql(d: Dialect, count: number): string {
  const columns = RUN_COLUMNS.join(', ')

  return (
    `WITH ranked AS (SELECT ${columns}, ` +
    `ROW_NUMBER() OVER (PARTITION BY parent_run_id ORDER BY started_at, run_id) AS rn ` +
    `FROM runs WHERE parent_run_id IN (${d.paramList(count)})) ` +
    `SELECT ${columns} FROM ranked WHERE rn <= ${d.param(count + 1)} ` +
    `ORDER BY parent_run_id, started_at, run_id`
  )
}

// Seeded from the asked ids rather than from `llm_attempts`: a command has no attempt of its own.
// UNION keeps one (root, run_id) pair however many attempts a run made or how a tree is shaped, so
// the join to the attempts counts each attempt once per root, and a cycle ends. The seed column is
// cast because an untyped bind in VALUES has no type to resolve against on Postgres.
function buildCostSql(d: Dialect, count: number): string {
  const seeds = Array.from({ length: count }, (_, i) => `(CAST(${d.param(i + 1)} AS TEXT))`)

  return (
    `WITH RECURSIVE seeds(id) AS (VALUES ${seeds.join(', ')}), ` +
    `tree(root, run_id) AS (` +
    `SELECT id, id FROM seeds ` +
    `UNION ` +
    `SELECT t.root, a.run_id FROM tree t JOIN llm_attempts a ON a.parent_run_id = t.run_id) ` +
    `SELECT t.root AS root, CAST(COALESCE(SUM(a.cost_nano_usd), 0) AS BIGINT) AS total ` +
    `FROM tree t JOIN llm_attempts a ON a.run_id = t.run_id GROUP BY t.root`
  )
}
