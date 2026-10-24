import type { AgentId } from '@/core/ids'
import type { Dialect, Storage } from '@/core/types/storage'
import type { CostRange, DaySpend, ModelRunCost, SpendBreakdownRow } from '@/core/types/usage'
import type { EpochRange } from '@/core/utils/time'
import type { LLMAttemptStore } from '@/persistence/types'
import { StorageError } from '@/core/errors'
import { agentId } from '@/core/ids'
import {
  dayBoundsInZone,
  dayInZone,
  dayRangeInZone,
  MS_PER_DAY,
  MS_PER_MINUTE,
  monthBoundsInZone,
} from '@/core/utils/time'
import { fromNanoUsd } from '@/persistence/money'
import { SQL_MAX_BIND_PARAMS } from '@/persistence/sql/syntax'

const ANSWERED_OUTCOME = 'success'
const BILLED_SEARCH_KIND = 'external'
// A day boundary is an instant on the operator's calendar, which no portable SQL can compute, so
// the read groups by quarter hour and folds buckets into days afterwards. Every zone's offset is
// a whole number of quarter hours, so no day boundary falls inside a bucket.
const DAY_BUCKET_MS = 15 * MS_PER_MINUTE
// A model's per-run cost reads this far back, so the scan stays on the `settled_at` index; the
// sample ranks runs inside it.
const MODEL_COST_WINDOW_MS = 30 * MS_PER_DAY
// The window start and the sample size are the two binds that are not model names.
const RESERVED_COST_BINDS = 2
const MODELS_PER_COST_QUERY = SQL_MAX_BIND_PARAMS - RESERVED_COST_BINDS
// A row written before the cap existed bills to the agent that ran it.
const BILLING_AGENT_SQL = "COALESCE(NULLIF(billing_agent_id, ''), agent_id)"

type SpendReads = Pick<
  LLMAttemptStore,
  | 'totalFor'
  | 'totalRange'
  | 'dailyRange'
  | 'breakdownFor'
  | 'breakdownRange'
  | 'totalForBillingAgent'
  | 'totalsForBillingAgents'
  | 'perRunCostByModel'
>

interface SpendBreakdownDbRow {
  readonly billing_agent_id: string
  readonly agent_id: string
  readonly provider: string
  readonly model: string
  readonly calls: number
  readonly failed_calls: number
  readonly cost_total: number
  readonly input_total: number
  readonly cache_read_total: number
  readonly cache_write_total: number
  readonly output_total: number
  readonly reasoning_total: number
  readonly latency_average: number | null
}

interface SpendDeps {
  readonly db: Storage
  readonly sql: ReturnType<typeof buildSpendSql>
  /** The calendar spend caps reset on. */
  readonly timeZone: string
}

/** The spend reads over the attempt facts: totals, days, breakdowns and one agent's day. Spend is
 *  derived from the facts over an indexed half-open `settled_at` window; there is no aggregate
 *  table to disagree with. */
export function createSpendReads(db: Storage, dialect: Dialect, timeZone: string): SpendReads {
  const deps: SpendDeps = { db, sql: buildSpendSql(dialect), timeZone }

  return {
    totalFor: async (period, nowMs) => sumBetween(deps, periodBounds(deps, period, nowMs)),
    totalRange: async (range) => sumBetween(deps, rangeBounds(deps, range)),
    dailyRange: async (range) => dailyBetween(deps, range),
    breakdownFor: async (period, nowMs) =>
      breakdownBetween(deps, periodBounds(deps, period, nowMs)),
    breakdownRange: async (range) => breakdownBetween(deps, rangeBounds(deps, range)),
    totalForBillingAgent: async (id, nowMs) =>
      sumForAgent(deps, id, dayBoundsInZone(nowMs, deps.timeZone)),
    totalsForBillingAgents: async (nowMs) =>
      sumByAgent(deps, dayBoundsInZone(nowMs, deps.timeZone)),
    perRunCostByModel: async (models, sample, nowMs) =>
      perRunCostOf(deps, { models, sample, nowMs }),
  }
}

function periodBounds(deps: SpendDeps, period: 'day' | 'month', nowMs: number): EpochRange {
  return period === 'day'
    ? dayBoundsInZone(nowMs, deps.timeZone)
    : monthBoundsInZone(nowMs, deps.timeZone)
}

// The inclusive day range becomes [fromDayStart, dayAfterToDayStart) on the operator's calendar,
// the same days `totalFor('day')` and the caps count, so a one-day range equals today's spend.
function rangeBounds(deps: SpendDeps, range: CostRange): EpochRange {
  const bounds = dayRangeInZone(range, deps.timeZone)

  if (bounds === undefined) {
    throw new StorageError(`invalid cost range day: '${range.fromDay}' to '${range.toDay}'`)
  }

  if (bounds.fromMs >= bounds.toMs) {
    throw new StorageError(`reversed cost range: '${range.fromDay}' to '${range.toDay}'`)
  }

  return bounds
}

async function perRunCostOf(
  deps: SpendDeps,
  query: { readonly models: readonly string[]; readonly sample: number; readonly nowMs: number }
): Promise<readonly ModelRunCost[]> {
  const { models, sample, nowMs } = query
  const costs: ModelRunCost[] = []

  for (let at = 0; at < models.length; at += MODELS_PER_COST_QUERY) {
    const chunk = models.slice(at, at + MODELS_PER_COST_QUERY)
    const rows = await deps.db.query<{
      readonly provider: string
      readonly model: string
      readonly mean_cost: number
    }>(deps.sql.perRunCost(chunk.length), [...chunk, nowMs - MODEL_COST_WINDOW_MS, sample])

    for (const row of rows) {
      costs.push({
        provider: row.provider,
        model: row.model,
        perRunUsd: fromNanoUsd(row.mean_cost),
      })
    }
  }

  return costs
}

async function sumBetween(deps: SpendDeps, bounds: EpochRange): Promise<number> {
  const rows = await deps.db.query<{ readonly total: number }>(deps.sql.sumBetween, [
    bounds.fromMs,
    bounds.toMs,
  ])

  return fromNanoUsd(rows[0]?.total ?? 0)
}

async function sumForAgent(deps: SpendDeps, id: AgentId, bounds: EpochRange): Promise<number> {
  const rows = await deps.db.query<{ readonly total: number }>(deps.sql.sumForBillingAgent, [
    bounds.fromMs,
    bounds.toMs,
    id,
  ])

  return fromNanoUsd(rows[0]?.total ?? 0)
}

async function sumByAgent(
  deps: SpendDeps,
  bounds: EpochRange
): Promise<ReadonlyMap<AgentId, number>> {
  const rows = await deps.db.query<{ readonly billing_agent_id: string; readonly total: number }>(
    deps.sql.sumByBillingAgent,
    [bounds.fromMs, bounds.toMs]
  )

  return new Map(rows.map((row) => [agentId(row.billing_agent_id), fromNanoUsd(row.total)]))
}

async function dailyBetween(deps: SpendDeps, range: CostRange): Promise<readonly DaySpend[]> {
  const bounds = rangeBounds(deps, range)
  const rows = await deps.db.query<{ readonly bucket: number; readonly total: number }>(
    deps.sql.dailyBuckets,
    [bounds.fromMs, bounds.toMs]
  )
  const nanoByDay = new Map<string, number>()

  for (const row of rows) {
    const day = dayInZone(row.bucket * DAY_BUCKET_MS, deps.timeZone)

    nanoByDay.set(day, (nanoByDay.get(day) ?? 0) + row.total)
  }

  return listDays(range).map((day) => ({
    day,
    costUsd: fromNanoUsd(nanoByDay.get(day) ?? 0),
  }))
}

// Called after `rangeBounds` accepted the range, so both ends parse and are in order.
function listDays(range: CostRange): readonly string[] {
  const days: string[] = []
  const end = Date.parse(range.toDay)

  for (let at = Date.parse(range.fromDay); at <= end; at += MS_PER_DAY) {
    days.push(new Date(at).toISOString().slice(0, 10))
  }

  return days
}

async function breakdownBetween(
  deps: SpendDeps,
  bounds: EpochRange
): Promise<readonly SpendBreakdownRow[]> {
  const rows = await deps.db.query<SpendBreakdownDbRow>(deps.sql.breakdownBetween, [
    bounds.fromMs,
    bounds.toMs,
    ANSWERED_OUTCOME,
    BILLED_SEARCH_KIND,
  ])

  return rows.map(toSpendBreakdownRow)
}

function toSpendBreakdownRow(row: SpendBreakdownDbRow): SpendBreakdownRow {
  return {
    billingAgentId: agentId(row.billing_agent_id),
    agentId: agentId(row.agent_id),
    provider: row.provider,
    model: row.model,
    calls: row.calls,
    failedCalls: row.failed_calls,
    costUsd: fromNanoUsd(row.cost_total),
    inputTokens: row.input_total,
    cacheReadTokens: row.cache_read_total,
    cacheWriteTokens: row.cache_write_total,
    outputTokens: row.output_total,
    reasoningTokens: row.reasoning_total,
    ...(row.latency_average === null ? {} : { averageLatencyMs: row.latency_average }),
  }
}

function buildSpendSql(d: Dialect) {
  return {
    sumBetween:
      `SELECT CAST(COALESCE(SUM(cost_nano_usd), 0) AS BIGINT) AS total FROM llm_attempts ` +
      `WHERE settled_at >= ${d.param(1)} AND settled_at < ${d.param(2)}`,
    sumForBillingAgent:
      `SELECT CAST(COALESCE(SUM(cost_nano_usd), 0) AS BIGINT) AS total FROM llm_attempts ` +
      `WHERE settled_at >= ${d.param(1)} AND settled_at < ${d.param(2)} ` +
      `AND ${BILLING_AGENT_SQL} = ${d.param(3)}`,
    sumByBillingAgent:
      `SELECT ${BILLING_AGENT_SQL} AS billing_agent_id, ` +
      `CAST(SUM(cost_nano_usd) AS BIGINT) AS total FROM llm_attempts ` +
      `WHERE settled_at >= ${d.param(1)} AND settled_at < ${d.param(2)} ` +
      `GROUP BY ${BILLING_AGENT_SQL}`,
    dailyBuckets:
      `SELECT settled_at / ${DAY_BUCKET_MS} AS bucket, ` +
      `CAST(SUM(cost_nano_usd) AS BIGINT) AS total FROM llm_attempts ` +
      `WHERE settled_at >= ${d.param(1)} AND settled_at < ${d.param(2)} GROUP BY 1`,
    perRunCost: (count: number) => buildPerRunCostSql(d, count),
    // Every SUM and the AVG are cast to BIGINT: postgres widens them to NUMERIC, which pg returns
    // as a string, while its INT8 parser is what makes a row read the same on both engines.
    breakdownBetween:
      `SELECT ${BILLING_AGENT_SQL} AS billing_agent_id, agent_id, provider, model, ` +
      `COUNT(*) AS calls, ` +
      `SUM(CASE WHEN outcome = ${d.param(3)} THEN 0 ELSE 1 END) AS failed_calls, ` +
      `CAST(SUM(cost_nano_usd) AS BIGINT) AS cost_total, ` +
      `CAST(SUM(input_tokens) AS BIGINT) AS input_total, ` +
      `CAST(SUM(cache_read_tokens) AS BIGINT) AS cache_read_total, ` +
      `CAST(SUM(cache_write_tokens) AS BIGINT) AS cache_write_total, ` +
      `CAST(SUM(output_tokens) AS BIGINT) AS output_total, ` +
      `CAST(SUM(reasoning_tokens) AS BIGINT) AS reasoning_total, ` +
      `CAST(AVG(CASE WHEN outcome = ${d.param(3)} AND kind <> ${d.param(4)} ` +
      `THEN latency_ms END) AS BIGINT) AS latency_average ` +
      `FROM llm_attempts WHERE settled_at >= ${d.param(1)} AND settled_at < ${d.param(2)} ` +
      `GROUP BY ${BILLING_AGENT_SQL}, agent_id, provider, model ` +
      `ORDER BY cost_total DESC, ${BILLING_AGENT_SQL}, agent_id, provider, model`,
  }
}

// A run's cost on a model is the sum of its attempts on it, ranked newest run first per model so the
// window is the model's own last runs, never a share of someone else's.
function buildPerRunCostSql(d: Dialect, count: number): string {
  return (
    `WITH per_run AS (SELECT provider, model, run_id, ` +
    `CAST(SUM(cost_nano_usd) AS BIGINT) AS cost, MAX(settled_at) AS last_at ` +
    `FROM llm_attempts WHERE model IN (${d.paramList(count)}) AND settled_at >= ${d.param(count + 1)} GROUP BY provider, model, run_id), ` +
    `ranked AS (SELECT provider, model, cost, ROW_NUMBER() OVER ` +
    `(PARTITION BY provider, model ORDER BY last_at DESC, run_id) AS recency FROM per_run) ` +
    `SELECT provider, model, CAST(AVG(cost) AS BIGINT) AS mean_cost FROM ranked ` +
    `WHERE recency <= ${d.param(count + 2)} GROUP BY provider, model`
  )
}
