import type { RunId } from '@/core/ids'
import type { Dialect, Storage } from '@/core/types/storage'
import type { CommandCostRange, RunLogRow, RunLogStore } from '@/persistence/types'
import { channelId } from '@/core/channels'
import { agentId, runId, sessionId } from '@/core/ids'
import { fromNanoUsd } from '@/persistence/money'
import { SQL_MAX_BIND_PARAMS } from '@/persistence/sql/syntax'
import { runTreeCtes } from '@/persistence/stores/run-tree-sql'

const LOW_PERCENTILE = 0.25
const HIGH_PERCENTILE = 0.75
const TICKER_SEPARATOR = ','

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
  'tickers',
  'questions_done',
  'questions_total',
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
  readonly tickers: string | null
  readonly questions_done: number | null
  readonly questions_total: number | null
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
    listResearch: async (agent, beforeMs, limit) =>
      (await db.query<DbRunRow>(sql.research, [agent, beforeMs, limit])).map(toRunLogRow),
    countResearch: async (agent, fromMs, toMs) =>
      (await db.query<{ readonly n: number }>(sql.countResearch, [agent, fromMs, toMs]))[0]?.n ?? 0,
    childrenOf: (ids, perRun) => childrenOf({ db, dialect }, ids, perRun),
    costOf: (ids) => costOf({ db, dialect }, ids),
    costRangeByName: (names, sample) => costRangeByName({ db, dialect }, names, sample),
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

// A sample's runs are every finished command row, so `runs` counts the free ones too; the range
// itself ignores them, because a reused answer costs nothing and would drag it down.
async function costRangeByName(
  deps: StoreDeps,
  names: readonly string[],
  sample: number
): Promise<ReadonlyMap<string, CommandCostRange>> {
  const sampled = new Map<string, RunId[]>()

  // One bind is the sample size, so a chunk holds one fewer name than the ceiling.
  for (const chunk of chunked(names, SQL_MAX_BIND_PARAMS - 1)) {
    const rows = await deps.db.query<{ readonly run_id: string; readonly name: string }>(
      buildSampleSql(deps.dialect, chunk.length),
      [...chunk, sample]
    )

    for (const row of rows) {
      sampled.set(row.name, [...(sampled.get(row.name) ?? []), runId(row.run_id)])
    }
  }

  const costs = await costOf(deps, [...sampled.values()].flat())
  const ranges = new Map<string, CommandCostRange>()

  for (const [name, ids] of sampled) {
    const paid = ids.map((id) => costs.get(id) ?? 0).filter((usd) => usd > 0)

    ranges.set(name, {
      lowUsd: percentile(paid, LOW_PERCENTILE),
      highUsd: percentile(paid, HIGH_PERCENTILE),
      runs: ids.length,
    })
  }

  return ranges
}

/** Linear interpolation between the closest ranks (the common "type 7" definition); 0 for no values. */
function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    return 0
  }

  const sorted = [...values].sort((a, b) => a - b)
  const at = (sorted.length - 1) * p
  const lower = Math.floor(at)
  const upper = Math.ceil(at)

  return (sorted[lower] ?? 0) + ((sorted[upper] ?? 0) - (sorted[lower] ?? 0)) * (at - lower)
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
    ...(row.tickers === null || row.tickers === ''
      ? {}
      : { tickers: row.tickers.split(TICKER_SEPARATOR) }),
    ...(row.questions_done === null ? {} : { questionsDone: row.questions_done }),
    ...(row.questions_total === null ? {} : { questionsTotal: row.questions_total }),
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
    row.tickers === undefined || row.tickers.length === 0
      ? null
      : row.tickers.join(TICKER_SEPARATOR),
    row.questionsDone ?? null,
    row.questionsTotal ?? null,
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
    countResearch:
      `SELECT COUNT(*) AS n FROM runs WHERE parent_run_id IS NULL AND kind = 'agent' ` +
      `AND name = ${d.param(1)} AND ended_at >= ${d.param(2)} AND ended_at < ${d.param(3)}`,
    research:
      `SELECT ${columns} FROM runs WHERE parent_run_id IS NULL AND kind = 'agent' ` +
      `AND session_id IS NOT NULL AND name = ${d.param(1)} AND ended_at < ${d.param(2)} ` +
      `ORDER BY ended_at DESC, run_id DESC LIMIT ${d.param(3)}`,
  }
}

function buildSampleSql(d: Dialect, count: number): string {
  return (
    `WITH ranked AS (SELECT run_id, name, ` +
    `ROW_NUMBER() OVER (PARTITION BY name ORDER BY ended_at DESC, run_id DESC) AS rn ` +
    `FROM runs WHERE kind = 'command' AND outcome = 'completed' AND name IN (${d.paramList(count)})) ` +
    `SELECT run_id, name FROM ranked WHERE rn <= ${d.param(count + 1)}`
  )
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

function buildCostSql(d: Dialect, count: number): string {
  return (
    runTreeCtes(d, count) +
    `SELECT t.root AS root, CAST(COALESCE(SUM(a.cost_nano_usd), 0) AS BIGINT) AS total ` +
    `FROM tree t JOIN llm_attempts a ON a.run_id = t.run_id GROUP BY t.root`
  )
}
