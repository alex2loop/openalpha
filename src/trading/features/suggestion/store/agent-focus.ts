import type { AgentFocus, FocusKey } from '@/trading/kernel/operator/focus'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted, StorageError } from '@/core/errors'
import { canonicalJson } from '@/core/utils/hash'
import { toAgentFocus } from '@/trading/kernel/operator/focus'
import { parseJson } from '@/trading/kernel/store/store-row'

// `Dialect.upsert` replaces every column, which would overwrite `first_seen_at`.
const UPSERT_SQL =
  'INSERT INTO agent_focuses (agent_id, focus_key, focus, first_seen_at, last_seen_at) VALUES '
const UPSERT_SET =
  ' ON CONFLICT (agent_id, focus_key) DO UPDATE SET last_seen_at = excluded.last_seen_at'
const SELECT_SQL =
  'SELECT agent_id, focus_key, focus, first_seen_at, last_seen_at FROM agent_focuses'

interface AgentFocusRow {
  readonly agent_id: string
  readonly focus_key: string
  readonly focus: string | null
  readonly first_seen_at: number
  readonly last_seen_at: number
}

export interface AgentFocusRecord {
  readonly agentId: string
  readonly focusKey: FocusKey
  readonly focus?: AgentFocus
  readonly firstSeenAt: number
  readonly lastSeenAt: number
}

interface RecordFocusInput {
  readonly agentId: string
  readonly focusKey: FocusKey
  readonly focus?: AgentFocus
  readonly at: number
  readonly signal: AbortSignal
}

/** Every focus an agent has made a call under, so a record survives an edit to its `[focus]`. */
export interface AgentFocusStore {
  record(input: RecordFocusInput): Promise<void>
  listFor(agentId: string, signal: AbortSignal): Promise<readonly AgentFocusRecord[]>
  listAll(signal: AbortSignal): Promise<readonly AgentFocusRecord[]>
  /** The agents that have called under a focus, in id order. */
  agentsOf(focusKey: FocusKey, signal: AbortSignal): Promise<readonly string[]>
}

export function createAgentFocusStore(deps: StoreDeps): AgentFocusStore {
  return {
    record: (input) => record(deps, input),
    listFor: (agentId, signal) => listFor(deps, agentId, signal),
    listAll: (signal) => listAll(deps, signal),
    agentsOf: (focusKey, signal) => agentsOf(deps, focusKey, signal),
  }
}

async function record(deps: StoreDeps, input: RecordFocusInput): Promise<void> {
  assertNotAborted(input.signal)

  await deps.db.execute(`${UPSERT_SQL}(${deps.dialect.paramList(5)})${UPSERT_SET}`, [
    input.agentId,
    input.focusKey,
    input.focus === undefined ? null : canonicalJson(input.focus),
    input.at,
    input.at,
  ])
}

async function listFor(
  deps: StoreDeps,
  agentId: string,
  signal: AbortSignal
): Promise<readonly AgentFocusRecord[]> {
  assertNotAborted(signal)

  const rows = await deps.db.query<AgentFocusRow>(
    `${SELECT_SQL} WHERE agent_id = ${deps.dialect.param(1)} ORDER BY first_seen_at, focus_key`,
    [agentId]
  )

  return rows.flatMap(readableRecord)
}

async function listAll(deps: StoreDeps, signal: AbortSignal): Promise<readonly AgentFocusRecord[]> {
  assertNotAborted(signal)

  const rows = await deps.db.query<AgentFocusRow>(
    `${SELECT_SQL} ORDER BY agent_id, first_seen_at, focus_key`,
    []
  )

  return rows.flatMap(readableRecord)
}

async function agentsOf(
  deps: StoreDeps,
  focusKey: FocusKey,
  signal: AbortSignal
): Promise<readonly string[]> {
  assertNotAborted(signal)

  const rows = await deps.db.query<Pick<AgentFocusRow, 'agent_id'>>(
    `SELECT agent_id FROM agent_focuses WHERE focus_key = ${deps.dialect.param(1)} ORDER BY agent_id`,
    [focusKey]
  )

  return rows.map((row) => row.agent_id)
}

/** A row whose focus no longer parses is skipped, so one stale `[focus]` cannot hide every other
 *  agent's record. Only a storage failure is skipped: anything else is a defect here. */
function readableRecord(row: AgentFocusRow): readonly AgentFocusRecord[] {
  try {
    return [toRecord(row)]
  } catch (err: unknown) {
    if (err instanceof StorageError) {
      return []
    }

    throw err
  }
}

function toRecord(row: AgentFocusRow): AgentFocusRecord {
  const focus =
    row.focus === null
      ? undefined
      : parseJson(row.focus, 'agent focus', (value) => toAgentFocus(value))

  return {
    agentId: row.agent_id,
    // why-safe: the column only ever holds `focusKey()` output.
    focusKey: row.focus_key as FocusKey,
    ...(focus === undefined ? {} : { focus }),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  }
}
