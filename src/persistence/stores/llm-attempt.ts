import type { LLMAttemptId, RunId } from '@/core/ids'
import type { LLMErrorCode, ProviderAttemptOutcome } from '@/core/llm'
import type { Dialect, Storage, Transaction } from '@/core/types/storage'
import type {
  CostSource,
  LLMAttemptInput,
  LLMAttemptKind,
  RunAttempt,
  RunCalls,
  UsageSource,
} from '@/core/types/usage'
import type { LLMAttempt, LLMAttemptStore } from '@/persistence/types'
import { StorageError } from '@/core/errors'
import { agentId, llmAttemptId, runId, sessionId } from '@/core/ids'
import { fromNanoUsd, toNanoUsd } from '@/persistence/money'
import { SQL_MAX_BIND_PARAMS } from '@/persistence/sql/syntax'
import { createSpendReads } from '@/persistence/stores/llm-attempt-spend'
import { runTreeCtes } from '@/persistence/stores/run-tree-sql'

// The column list has one owner: the insert, the idempotent-retry read, and the detail read in
// stores/session.ts all enumerate exactly these, in this order.
export const LLM_ATTEMPT_COLUMNS = [
  'id',
  'session_id',
  'run_id',
  'parent_run_id',
  'agent_id',
  'billing_agent_id',
  'message_idx',
  'kind',
  'provider',
  'model',
  'outcome',
  'error_code',
  'usage_source',
  'cost_source',
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'reasoning_tokens',
  'cost_nano_usd',
  'latency_ms',
  'settled_at',
] as const

export interface LLMAttemptRow {
  readonly id: string
  readonly session_id: string | null
  readonly run_id: string
  readonly parent_run_id: string | null
  readonly agent_id: string
  /** Empty on a row written before the cap existed: those bill to the agent that ran them. */
  readonly billing_agent_id: string
  readonly message_idx: number | null
  readonly kind: LLMAttemptKind
  readonly provider: string
  readonly model: string
  readonly outcome: ProviderAttemptOutcome
  readonly error_code: LLMErrorCode | null
  readonly usage_source: UsageSource
  readonly cost_source: CostSource
  readonly input_tokens: number
  readonly output_tokens: number
  readonly cache_read_tokens: number
  readonly cache_write_tokens: number
  readonly reasoning_tokens: number
  readonly cost_nano_usd: number
  readonly latency_ms: number
  readonly settled_at: number
}

interface StoreDeps {
  readonly db: Storage
  readonly sql: ReturnType<typeof buildSql>
}

export function createLLMAttemptStore(
  db: Storage,
  dialect: Dialect,
  timeZone: string
): LLMAttemptStore {
  const store: StoreDeps = { db, sql: buildSql(dialect) }

  return {
    record: (attempt) => record(store, attempt),
    ...createSpendReads(db, dialect, timeZone),
    attemptsForRun: (id, limit) => attemptsForRun(store, id, limit),
    recordedIds: (ids) => recordedIds(store, dialect, ids),
  }
}

// Map a stored fact row back to the canonical shape; brand-parsing is the only validation the
// CHECK constraints do not already guarantee.
export function toLlmAttempt(row: LLMAttemptRow): LLMAttempt {
  return {
    ...toRunAttempt(row),
    sessionId: row.session_id === null ? null : sessionId(row.session_id),
    messageIdx: row.message_idx,
  }
}

function toRunAttempt(row: LLMAttemptRow): RunAttempt {
  const base = {
    id: llmAttemptId(row.id),
    runId: runId(row.run_id),
    ...(row.parent_run_id === null ? {} : { parentRunId: runId(row.parent_run_id) }),
    agentId: agentId(row.agent_id),
    billingAgentId: agentId(row.billing_agent_id === '' ? row.agent_id : row.billing_agent_id),
    kind: row.kind,
    provider: row.provider,
    model: row.model,
    usageSource: row.usage_source,
    costSource: row.cost_source,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    reasoningTokens: row.reasoning_tokens,
    costUsd: fromNanoUsd(row.cost_nano_usd),
    latencyMs: row.latency_ms,
    settledAt: row.settled_at,
  }

  if (row.outcome === 'success') {
    return { ...base, outcome: 'success' }
  }

  if (row.error_code === null) {
    throw new StorageError(`corrupt llm_attempts row ${row.id}: failure without error_code`)
  }

  return { ...base, outcome: row.outcome, errorCode: row.error_code }
}

// A list under `limit` is the whole subtree, so its totals come from the rows; a full one may be cut
// and asks the tree once more. The id tie-break keeps equal instants in a stable order.
async function attemptsForRun(store: StoreDeps, id: RunId, limit: number): Promise<RunCalls> {
  const rows = await store.db.query<LLMAttemptRow>(store.sql.forRun, [id, limit])
  const calls = rows.map(toRunAttempt)

  if (rows.length < limit) {
    const nano = rows.reduce((sum, row) => sum + row.cost_nano_usd, 0)

    return { calls, totalCalls: rows.length, totalUsd: fromNanoUsd(nano) }
  }

  const [total] = await store.db.query<{ readonly calls: number; readonly total: number }>(
    store.sql.totalForRun,
    [id]
  )

  return { calls, totalCalls: total?.calls ?? 0, totalUsd: fromNanoUsd(total?.total ?? 0) }
}

// One transaction: a failed write leaves neither an attempt fact nor a misleading total. The
// only clock value persisted is the caller's settledAt.
async function record(store: StoreDeps, attempt: LLMAttemptInput): Promise<void> {
  const costNanoUsd = toNanoUsd(attempt.costUsd)

  await store.db.transaction(async (tx) => {
    const { changes } = await tx.execute(store.sql.insert, attemptParams(attempt, costNanoUsd))

    if (changes === 0) {
      await assertExactDuplicate({ tx, sql: store.sql, attempt, costNanoUsd })
      return
    }

    await tx.execute(store.sql.touchActivity, [
      attempt.settledAt,
      attempt.settledAt,
      attempt.sessionId,
    ])
  })
}

// ON CONFLICT DO NOTHING makes a retry of the same sink write idempotent — but only if the
// existing row is the same fact. session_id and message_idx are excluded: linking and history
// deletion mutate them after insert.
async function assertExactDuplicate(input: {
  readonly tx: Transaction
  readonly sql: ReturnType<typeof buildSql>
  readonly attempt: LLMAttemptInput
  readonly costNanoUsd: number
}): Promise<void> {
  const { tx, sql, attempt, costNanoUsd } = input
  const rows = await tx.query<LLMAttemptRow>(sql.loadById, [attempt.id])
  const row = rows[0]

  if (row === undefined) {
    throw new StorageError(`llm_attempts conflict without a row for id ${attempt.id}`)
  }

  const field = mismatchedField(row, attempt, costNanoUsd)

  if (field !== undefined) {
    throw new StorageError(`llm_attempt ${attempt.id} re-recorded with a different ${field}`)
  }
}

function mismatchedField(
  row: LLMAttemptRow,
  attempt: LLMAttemptInput,
  costNanoUsd: number
): string | undefined {
  const pairs: readonly (readonly [string, unknown, unknown])[] = [
    ['run_id', row.run_id, attempt.runId],
    ['parent_run_id', row.parent_run_id, attempt.parentRunId ?? null],
    ['agent_id', row.agent_id, attempt.agentId],
    ['billing_agent_id', row.billing_agent_id, attempt.billingAgentId],
    ['kind', row.kind, attempt.kind],
    ['provider', row.provider, attempt.provider],
    ['model', row.model, attempt.model],
    ['outcome', row.outcome, attempt.outcome],
    ['error_code', row.error_code, attempt.errorCode ?? null],
    ['usage_source', row.usage_source, attempt.usageSource],
    ['cost_source', row.cost_source, attempt.costSource],
    ['input_tokens', row.input_tokens, attempt.inputTokens],
    ['output_tokens', row.output_tokens, attempt.outputTokens],
    ['cache_read_tokens', row.cache_read_tokens, attempt.cacheReadTokens],
    ['cache_write_tokens', row.cache_write_tokens, attempt.cacheWriteTokens],
    ['reasoning_tokens', row.reasoning_tokens, attempt.reasoningTokens],
    ['cost_nano_usd', row.cost_nano_usd, costNanoUsd],
    ['latency_ms', row.latency_ms, attempt.latencyMs],
    ['settled_at', row.settled_at, attempt.settledAt],
  ]
  const mismatch = pairs.find(([, stored, incoming]) => stored !== incoming)

  return mismatch?.[0]
}

// The id list comes from the unrecorded-spend log, which is bounded by one month of failed writes
// but can still exceed sqlite's default bind ceiling, so each IN (...) is chunked to that limit.
async function recordedIds(
  store: StoreDeps,
  dialect: Dialect,
  ids: readonly LLMAttemptId[]
): Promise<ReadonlySet<LLMAttemptId>> {
  const recorded = new Set<LLMAttemptId>()

  for (const chunk of chunkIds(ids)) {
    const sql = `SELECT id FROM llm_attempts WHERE id IN (${dialect.paramList(chunk.length)})`
    const rows = await store.db.query<{ readonly id: string }>(sql, [...chunk])

    for (const row of rows) {
      recorded.add(llmAttemptId(row.id))
    }
  }

  return recorded
}

function chunkIds(ids: readonly LLMAttemptId[]): readonly (readonly LLMAttemptId[])[] {
  const chunks: (readonly LLMAttemptId[])[] = []

  for (let index = 0; index < ids.length; index += SQL_MAX_BIND_PARAMS) {
    chunks.push(ids.slice(index, index + SQL_MAX_BIND_PARAMS))
  }

  return chunks
}

function buildSql(d: Dialect) {
  const columns = LLM_ATTEMPT_COLUMNS.join(', ')

  return {
    insert:
      `INSERT INTO llm_attempts (${columns}) VALUES (${d.paramList(LLM_ATTEMPT_COLUMNS.length)}) ` +
      `ON CONFLICT (id) DO NOTHING`,
    loadById: `SELECT ${columns} FROM llm_attempts WHERE id = ${d.param(1)}`,
    forRun:
      `${runTreeCtes(d, 1)}SELECT ${columns} FROM llm_attempts ` +
      `WHERE run_id IN (SELECT run_id FROM tree) ` +
      `ORDER BY settled_at DESC, id LIMIT ${d.param(2)}`,
    totalForRun:
      `${runTreeCtes(d, 1)}SELECT COUNT(*) AS calls, ` +
      `CAST(COALESCE(SUM(cost_nano_usd), 0) AS BIGINT) AS total FROM llm_attempts ` +
      `WHERE run_id IN (SELECT run_id FROM tree)`,
    // Portable monotonic advance: MAX(current, settled_at) without dialect-specific GREATEST.
    touchActivity:
      `UPDATE sessions SET last_activity_at = ` +
      `CASE WHEN last_activity_at < ${d.param(1)} THEN ${d.param(2)} ELSE last_activity_at END ` +
      `WHERE id = ${d.param(3)}`,
  }
}

function attemptParams(attempt: LLMAttemptInput, costNanoUsd: number): readonly unknown[] {
  return [
    attempt.id,
    attempt.sessionId,
    attempt.runId,
    attempt.parentRunId ?? null,
    attempt.agentId,
    attempt.billingAgentId,
    // message_idx stays null at record time; transcript linking owns it from here on.
    null,
    attempt.kind,
    attempt.provider,
    attempt.model,
    attempt.outcome,
    attempt.errorCode ?? null,
    attempt.usageSource,
    attempt.costSource,
    attempt.inputTokens,
    attempt.outputTokens,
    attempt.cacheReadTokens,
    attempt.cacheWriteTokens,
    attempt.reasoningTokens,
    costNanoUsd,
    attempt.latencyMs,
    attempt.settledAt,
  ]
}
