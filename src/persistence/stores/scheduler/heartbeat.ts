import type { AgentId, HeartbeatCommitmentId } from '@/core/ids'
import type { Dialect, Storage } from '@/core/types/storage'
import { heartbeatCommitmentId } from '@/core/ids'
import { paramList } from '@/persistence/sql/syntax'

const LIST_LEASED_AGENTS =
  'SELECT DISTINCT agent_id FROM heartbeat_task_completions WHERE lease_token IS NOT NULL'

// Declared locally: persistence cannot import the scheduler-owned interface (DAG); app binds this
// store structurally to HeartbeatDeps.store. The branded commitment id is shared from core/ids so
// persistence and scheduler validate the same identifier without a persistence→scheduler edge.
interface StoredHeartbeatCommitment {
  readonly id: HeartbeatCommitmentId
  readonly taskName: string
  readonly prompt: string
  readonly dueAt: number
}

interface NewStoredCommitment {
  readonly id: HeartbeatCommitmentId
  readonly prompt: string
  readonly dueAt: number
}

interface CompleteTaskInput {
  readonly agentId: AgentId
  readonly taskName: string
  readonly token: string
  readonly completedAt: number
  readonly consumedCommitmentIds: readonly HeartbeatCommitmentId[]
  readonly newCommitments: readonly NewStoredCommitment[]
  readonly maxPendingCommitmentsPerAgent: number
}

type CompleteTaskOutcome =
  | { readonly kind: 'completed'; readonly inserted: number }
  | { readonly kind: 'lease_lost' }

interface ClaimTaskInput {
  readonly agentId: AgentId
  readonly taskName: string
  readonly token: string
  readonly now: number
  /** Due when the last completion is at or before this, or ahead of `now` (clock stepped back). */
  readonly dueBefore: number
  readonly leaseExpiresBefore: number
}

type ClaimTaskOutcome =
  | { readonly kind: 'claimed'; readonly consecutiveFailures: number }
  | { readonly kind: 'not_claimed' }

interface ReleaseTaskInput {
  readonly agentId: AgentId
  readonly taskName: string
  readonly token: string
}

interface RecordFailureInput {
  readonly agentId: AgentId
  readonly taskName: string
  readonly token: string
  readonly nextRetryAt: number
}

interface ListDueCommitmentsInput {
  readonly agentId: AgentId
  readonly taskName: string
  readonly now: number
  readonly limit: number
}

interface StoredHeartbeatStore {
  syncAgents(agentIds: readonly AgentId[]): Promise<void>
  syncTasks(agentId: AgentId, taskNames: readonly string[]): Promise<void>
  claimTask(input: ClaimTaskInput): Promise<ClaimTaskOutcome>
  releaseTask(input: ReleaseTaskInput): Promise<void>
  recordFailure(input: RecordFailureInput): Promise<void>
  listDueCommitments(input: ListDueCommitmentsInput): Promise<readonly StoredHeartbeatCommitment[]>
  completeTask(input: CompleteTaskInput): Promise<CompleteTaskOutcome>
}

interface CommitmentRow {
  readonly id: string
  readonly task_name: string
  readonly prompt: string
  readonly due_at: number
}

interface HeartbeatSql {
  readonly listAgents: string
  readonly listLeasedAgents: string
  readonly listLeasedTasks: string
  readonly deleteCompletionsForAgents: (count: number) => string
  readonly deleteCommitmentsForAgents: (count: number) => string
  readonly deleteAllCompletionsForAgent: string
  readonly deleteAllCommitmentsForAgent: string
  readonly deleteTasks: (count: number) => string
  readonly deleteTasksCommitments: (count: number) => string
  readonly claimTask: string
  readonly releaseTask: string
  readonly recordFailure: string
  readonly selectDueCommitments: string
  readonly deleteConsumedCommitments: (count: number) => string
  readonly countPendingCommitments: string
  readonly insertCommitment: string
  readonly markCompleted: string
}

// `db` and `sql` always travel together; bundling them keeps each method helper at ≤3 parameters.
interface StoreDeps {
  readonly db: Storage
  readonly sql: HeartbeatSql
}

export function createHeartbeatStore(db: Storage, dialect: Dialect): StoredHeartbeatStore {
  const store: StoreDeps = { db, sql: buildSql(dialect) }

  return {
    syncAgents: (agentIds) => syncAgents(store, agentIds),
    syncTasks: (agentId, taskNames) => syncTasks(store, agentId, taskNames),
    claimTask: (input) => claimTask(store, input),
    releaseTask: (input) => releaseTask(store, input),
    recordFailure: (input) => recordFailure(store, input),
    listDueCommitments: (input) => listDueCommitments(store, input),
    completeTask: (input) => completeTask(store, input),
  }
}

// Sync collects garbage, and a leased row is live work: deleting it makes its owner's completion
// land on nothing. Leased rows survive until a later pass, once the lease has cleared.
async function syncAgents(store: StoreDeps, agentIds: readonly AgentId[]): Promise<void> {
  const { db, sql } = store

  await db.transaction(async (tx) => {
    const rows = await tx.query<{ readonly agent_id: string }>(sql.listAgents)
    const leased = await tx.query<{ readonly agent_id: string }>(sql.listLeasedAgents)
    const stored = new Set(rows.map((row) => row.agent_id))
    const keep = new Set([...agentIds.map((id) => String(id)), ...leased.map((r) => r.agent_id)])
    const toRemove = [...stored].filter((id) => !keep.has(id))

    if (toRemove.length === 0) {
      return
    }

    await tx.execute(sql.deleteCompletionsForAgents(toRemove.length), toRemove)
    await tx.execute(sql.deleteCommitmentsForAgents(toRemove.length), toRemove)
  })
}

async function syncTasks(
  store: StoreDeps,
  agentId: AgentId,
  taskNames: readonly string[]
): Promise<void> {
  const { db, sql } = store

  await db.transaction(async (tx) => {
    const leased = await tx.query<{ readonly task_name: string }>(sql.listLeasedTasks, [agentId])
    const names = [...new Set([...taskNames, ...leased.map((row) => row.task_name)])]

    if (names.length === 0) {
      await tx.execute(sql.deleteAllCompletionsForAgent, [agentId])
      await tx.execute(sql.deleteAllCommitmentsForAgent, [agentId])

      return
    }

    await tx.execute(sql.deleteTasks(names.length), [agentId, ...names])
    await tx.execute(sql.deleteTasksCommitments(names.length), [agentId, ...names])
  })
}

// The due check and the lease are one statement: two instances reading the same completion cannot
// both proceed, because only one of them changes a row. A missing row inserts as claimed-and-due.
// RETURNING the prior failure count lets the caller compute backoff without a second round trip.
async function claimTask(store: StoreDeps, input: ClaimTaskInput): Promise<ClaimTaskOutcome> {
  const rows = await store.db.query<{ readonly consecutive_failures: number }>(
    store.sql.claimTask,
    [
      input.agentId,
      input.taskName,
      input.token,
      input.now,
      input.dueBefore,
      input.leaseExpiresBefore,
    ]
  )
  const row = rows[0]

  return row === undefined
    ? { kind: 'not_claimed' }
    : { kind: 'claimed', consecutiveFailures: row.consecutive_failures }
}

// A no-op once `completeTask` has cleared the token, so the caller can always release in `finally`.
async function releaseTask(store: StoreDeps, input: ReleaseTaskInput): Promise<void> {
  await store.db.execute(store.sql.releaseTask, [input.agentId, input.taskName, input.token])
}

// Best-effort by design: still keyed on the lease token, so a lost lease (another claimant, or a
// concurrent completion) makes this a silent no-op rather than a spurious extra failure recorded.
async function recordFailure(store: StoreDeps, input: RecordFailureInput): Promise<void> {
  await store.db.execute(store.sql.recordFailure, [
    input.nextRetryAt,
    input.agentId,
    input.taskName,
    input.token,
  ])
}

async function listDueCommitments(
  store: StoreDeps,
  input: ListDueCommitmentsInput
): Promise<readonly StoredHeartbeatCommitment[]> {
  const rows = await store.db.query<CommitmentRow>(store.sql.selectDueCommitments, [
    input.agentId,
    input.taskName,
    input.now,
    input.limit,
  ])

  return rows.map(toStoredCommitment)
}

// One transaction in this order: release the lease (which is also the ownership check, so a lost
// lease consumes nothing), delete consumed commitments, count remaining capacity, then insert the
// bounded new set. Any failure rolls back all four effects.
async function completeTask(
  store: StoreDeps,
  input: CompleteTaskInput
): Promise<CompleteTaskOutcome> {
  const { db, sql } = store

  return await db.transaction(async (tx) => {
    const completed = await tx.execute(sql.markCompleted, [
      input.completedAt,
      input.agentId,
      input.taskName,
      input.token,
    ])

    if (completed.changes === 0) {
      return { kind: 'lease_lost' }
    }

    if (input.consumedCommitmentIds.length > 0) {
      await tx.execute(sql.deleteConsumedCommitments(input.consumedCommitmentIds.length), [
        input.agentId,
        input.taskName,
        ...input.consumedCommitmentIds,
      ])
    }

    const countRows = await tx.query<{ readonly n: number }>(sql.countPendingCommitments, [
      input.agentId,
    ])
    const pendingCount = countRows[0]?.n ?? 0
    const availableSlots = Math.max(0, input.maxPendingCommitmentsPerAgent - pendingCount)
    const insertable = input.newCommitments.slice(0, availableSlots)

    for (const commitment of insertable) {
      await tx.execute(sql.insertCommitment, [
        commitment.id,
        input.agentId,
        input.taskName,
        commitment.prompt,
        commitment.dueAt,
        input.completedAt,
      ])
    }

    return { kind: 'completed', inserted: insertable.length }
  })
}

function toStoredCommitment(row: CommitmentRow): StoredHeartbeatCommitment {
  return {
    id: heartbeatCommitmentId(row.id),
    taskName: row.task_name,
    prompt: row.prompt,
    dueAt: row.due_at,
  }
}

// Grouped the way the store's methods are: registry upkeep, the task lease, and commitments.
function buildSql(d: Dialect): HeartbeatSql {
  return { ...buildRegistrySql(d), ...buildLeaseSql(d), ...buildCommitmentSql(d) }
}

type RegistrySql = Pick<
  HeartbeatSql,
  | 'listAgents'
  | 'listLeasedAgents'
  | 'listLeasedTasks'
  | 'deleteCompletionsForAgents'
  | 'deleteCommitmentsForAgents'
  | 'deleteAllCompletionsForAgent'
  | 'deleteAllCommitmentsForAgent'
  | 'deleteTasks'
  | 'deleteTasksCommitments'
>

function buildRegistrySql(d: Dialect): RegistrySql {
  return {
    listAgents:
      'SELECT agent_id FROM heartbeat_task_completions UNION SELECT agent_id FROM heartbeat_commitments',
    listLeasedAgents: LIST_LEASED_AGENTS,
    listLeasedTasks: buildLeasedTasksSql(d),
    deleteCompletionsForAgents: (count: number) =>
      `DELETE FROM heartbeat_task_completions WHERE agent_id IN (${paramList(d.param, count)})`,
    deleteCommitmentsForAgents: (count: number) =>
      `DELETE FROM heartbeat_commitments WHERE agent_id IN (${paramList(d.param, count)})`,
    deleteAllCompletionsForAgent: `DELETE FROM heartbeat_task_completions WHERE agent_id = ${d.param(
      1
    )}`,
    deleteAllCommitmentsForAgent: `DELETE FROM heartbeat_commitments WHERE agent_id = ${d.param(1)}`,
    deleteTasks: (count: number) =>
      `DELETE FROM heartbeat_task_completions WHERE agent_id = ${d.param(1)} AND task_name NOT IN (${paramList(
        d.param,
        count,
        2
      )})`,
    deleteTasksCommitments: (count: number) =>
      `DELETE FROM heartbeat_commitments WHERE agent_id = ${d.param(1)} AND task_name NOT IN (${paramList(
        d.param,
        count,
        2
      )})`,
  }
}

function buildLeaseSql(
  d: Dialect
): Pick<HeartbeatSql, 'claimTask' | 'releaseTask' | 'recordFailure' | 'markCompleted'> {
  return {
    claimTask: buildClaimSql(d),
    releaseTask:
      `UPDATE heartbeat_task_completions SET lease_token = NULL, lease_started_at = NULL ` +
      `WHERE agent_id = ${d.param(1)} AND task_name = ${d.param(2)} AND lease_token = ${d.param(3)}`,
    recordFailure:
      `UPDATE heartbeat_task_completions SET ` +
      `consecutive_failures = consecutive_failures + 1, next_retry_at = ${d.param(1)} ` +
      `WHERE agent_id = ${d.param(2)} AND task_name = ${d.param(3)} AND lease_token = ${d.param(4)}`,
    // A success clears the backoff state along with the lease: the next claim is due purely off
    // last_completed_at again.
    markCompleted:
      `UPDATE heartbeat_task_completions SET last_completed_at = ` +
      `CASE WHEN ${d.param(1)} > last_completed_at THEN ${d.param(1)} ELSE last_completed_at END, ` +
      `lease_token = NULL, lease_started_at = NULL, consecutive_failures = 0, next_retry_at = NULL ` +
      `WHERE agent_id = ${d.param(2)} AND task_name = ${d.param(3)} AND lease_token = ${d.param(4)}`,
  }
}

type CommitmentSql = Pick<
  HeartbeatSql,
  | 'selectDueCommitments'
  | 'deleteConsumedCommitments'
  | 'countPendingCommitments'
  | 'insertCommitment'
>

function buildCommitmentSql(d: Dialect): CommitmentSql {
  return {
    selectDueCommitments: `SELECT id, task_name, prompt, due_at FROM heartbeat_commitments WHERE agent_id = ${d.param(
      1
    )} AND task_name = ${d.param(2)} AND due_at <= ${d.param(3)} ORDER BY due_at LIMIT ${d.param(4)}`,
    deleteConsumedCommitments: (count: number) =>
      `DELETE FROM heartbeat_commitments WHERE agent_id = ${d.param(1)} AND task_name = ${d.param(
        2
      )} AND id IN (${paramList(d.param, count, 3)})`,
    countPendingCommitments: `SELECT COUNT(*) AS n FROM heartbeat_commitments WHERE agent_id = ${d.param(
      1
    )}`,
    insertCommitment:
      `INSERT INTO heartbeat_commitments (id, agent_id, task_name, prompt, due_at, created_at) ` +
      `VALUES (${d.param(1)}, ${d.param(2)}, ${d.param(3)}, ${d.param(4)}, ${d.param(5)}, ${d.param(
        6
      )})`,
  }
}

function buildLeasedTasksSql(d: Dialect): string {
  return (
    `SELECT task_name FROM heartbeat_task_completions ` +
    `WHERE agent_id = ${d.param(1)} AND lease_token IS NOT NULL`
  )
}

function buildClaimSql(d: Dialect): string {
  const table = 'heartbeat_task_completions'
  const due = `${table}.last_completed_at <= ${d.param(5)} OR ${table}.last_completed_at > ${d.param(4)}`
  const unleased = `${table}.lease_token IS NULL OR ${table}.lease_started_at < ${d.param(6)}`
  const notBackedOff = `${table}.next_retry_at IS NULL OR ${table}.next_retry_at <= ${d.param(4)}`

  return (
    `INSERT INTO ${table} (agent_id, task_name, last_completed_at, lease_token, lease_started_at) ` +
    `VALUES (${d.param(1)}, ${d.param(2)}, 0, ${d.param(3)}, ${d.param(4)}) ` +
    `ON CONFLICT (agent_id, task_name) DO UPDATE SET ` +
    `lease_token = ${d.param(3)}, lease_started_at = ${d.param(4)} ` +
    `WHERE (${due}) AND (${unleased}) AND (${notBackedOff}) ` +
    `RETURNING consecutive_failures`
  )
}
