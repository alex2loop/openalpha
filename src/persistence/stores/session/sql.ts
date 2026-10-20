import type { Dialect } from '@/core/types/storage'
import { LLM_ATTEMPT_COLUMNS } from '@/persistence/stores/llm-attempt'

// One owner of the session store's SQL text: lifecycle, transcript, attempt-linking, and route
// cleanup statements. Callers bind parameters in the order each statement declares them.
const PAYLOAD_COLS = 'role, content, tool_call_id, reasoning_blocks, is_error'
// Every attempt against a model, billed whether or not it came back; an `external` row is a vendor
// fee rather than a call. (COUNT(*) FILTER is not portable; the CASE form runs on both dialects.)
const MODEL_CALLS_CASE = `CASE WHEN kind <> 'external' THEN 1 ELSE 0 END`
// The model behind a billed call, folded the same way. `MIN` is only a name worth printing when
// exactly one model billed, which is why the count rides beside it: naming the alphabetically
// first of several would claim a run one model did not serve.
const BILLED_MODEL_CASE = `CASE WHEN kind <> 'external' THEN model END`
const SUM_COLS = [
  'cost_nano_usd',
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'reasoning_tokens',
] as const
// Cast back to BIGINT: postgres widens SUM(bigint) to NUMERIC, which the driver hands back as a
// string into columns typed `number`. Valid on both dialects; sqlite is unaffected.
const TOTALS_FOLD_COLS = [
  ...SUM_COLS.map((col) => `CAST(COALESCE(SUM(${col}), 0) AS BIGINT) AS ${col}`),
  `CAST(COALESCE(SUM(${MODEL_CALLS_CASE}), 0) AS BIGINT) AS model_calls`,
  `COUNT(DISTINCT ${BILLED_MODEL_CASE}) AS model_count`,
  `MIN(${BILLED_MODEL_CASE}) AS model_name`,
].join(', ')

export interface SessionSql {
  readonly create: string
  readonly insertIfAbsent: string
  readonly claim: string
  readonly selectOwner: string
  readonly loadSession: string
  readonly resolveIdPrefix: string
  readonly loadPayloads: string
  readonly loadPayloadTail: string
  readonly loadTranscriptNewest: string
  readonly loadTranscriptBefore: string
  readonly loadMessages: string
  readonly loadAttempts: string
  readonly loadTotals: string
  readonly insertMessage: string
  readonly nextIdx: string
  readonly lastMessageAt: string
  readonly linkAttempt: string
  readonly linkedGroup: string
  readonly touchActivity: string
  readonly finalize: string
  readonly updateStatus: string
  readonly listRecent: string
  readonly latestIdForChannel: string
  readonly selectRun: string
  readonly removeRoutes: string
  readonly removeMessages: string
  readonly detachAttempts: string
  readonly remove: string
  readonly countAll: string
  readonly countByAgent: string
  readonly countRunningAll: string
  readonly countRunningByAgent: string
  readonly clearRoutesAll: string
  readonly clearRoutesByAgent: string
  readonly clearMessagesAll: string
  readonly clearMessagesByAgent: string
  readonly detachAttemptsAll: string
  readonly detachAttemptsByAgent: string
  readonly clearAll: string
  readonly clearByAgent: string
  readonly markStale: string
}

export function buildSessionSql(d: Dialect): SessionSql {
  return {
    ...buildClaimSql(d),
    ...buildTranscriptSql(d),
    loadSession:
      `SELECT id, agent_id, user_id, channel, chat_id, status, end_reason, error_message, ` +
      `started_at, last_activity_at, ended_at FROM sessions WHERE id = ${d.param(1)} LIMIT 1`,
    resolveIdPrefix:
      `SELECT id FROM sessions WHERE id LIKE ${d.param(1)} ESCAPE '\\' ` +
      `ORDER BY CASE WHEN id = ${d.param(2)} THEN 0 ELSE 1 END, id LIMIT ${d.param(3)}`,
    loadMessages:
      `SELECT idx, run_id, ${PAYLOAD_COLS}, created_at FROM session_messages ` +
      `WHERE session_id = ${d.param(1)} ORDER BY idx`,
    loadAttempts: `SELECT ${LLM_ATTEMPT_COLUMNS.join(', ')} FROM llm_attempts WHERE session_id = ${d.param(1)} ORDER BY settled_at, id`,
    loadTotals: `SELECT ${TOTALS_FOLD_COLS} FROM llm_attempts WHERE session_id = ${d.param(1)}`,
    insertMessage:
      `INSERT INTO session_messages (session_id, idx, run_id, ${PAYLOAD_COLS}, created_at) ` +
      `VALUES (${d.paramList(9)})`,
    nextIdx: `SELECT MAX(idx) + 1 AS next FROM session_messages WHERE session_id = ${d.param(1)}`,
    // The primary key is (session_id, idx), so the newest row is one index step.
    lastMessageAt:
      `SELECT created_at FROM session_messages WHERE session_id = ${d.param(1)} ` +
      `ORDER BY idx DESC LIMIT 1`,
    linkAttempt:
      `UPDATE llm_attempts SET message_idx = ${d.param(1)} ` +
      `WHERE id = ${d.param(2)} AND session_id = ${d.param(3)} AND kind = 'turn' AND message_idx IS NULL`,
    linkedGroup: `SELECT outcome FROM llm_attempts WHERE session_id = ${d.param(1)} AND message_idx = ${d.param(2)}`,
    touchActivity: `UPDATE sessions SET last_activity_at = ${d.param(1)} WHERE id = ${d.param(2)}`,
    finalize:
      `UPDATE sessions SET status = 'done', end_reason = ${d.param(1)}, ` +
      `error_message = ${d.param(2)}, ended_at = ${d.param(3)}, last_activity_at = ${d.param(4)}, ` +
      `active_run_id = NULL WHERE id = ${d.param(5)} AND active_run_id = ${d.param(6)}`,
    updateStatus:
      `UPDATE sessions SET status = ${d.param(1)}, ended_at = ${d.param(2)}, ` +
      `last_activity_at = ${d.param(3)} WHERE id = ${d.param(4)} AND active_run_id IS NULL`,
    listRecent: listRecentSql(d),
    latestIdForChannel: `SELECT id FROM sessions WHERE channel = ${d.param(1)} ORDER BY last_activity_at DESC LIMIT 1`,
    ...buildRemoveSql(d),
    ...buildClearSql(d),
    markStale:
      `UPDATE sessions SET status = 'stale', end_reason = 'daemon_restarted', ` +
      `error_message = 'daemon restarted while session was active', ended_at = ${d.param(1)}, ` +
      `active_run_id = NULL WHERE status = 'active' ` +
      `AND (active_run_id IS NULL OR last_activity_at < ${d.param(2)})`,
  }
}

type TranscriptSql = Pick<
  SessionSql,
  'loadPayloads' | 'loadPayloadTail' | 'loadTranscriptNewest' | 'loadTranscriptBefore'
>

// Display pages read user/assistant rows newest first; the caller asks for one row past the page.
function buildTranscriptSql(d: Dialect): TranscriptSql {
  const head = `SELECT idx, ${PAYLOAD_COLS} FROM session_messages WHERE session_id = ${d.param(1)} `
  const roles = `AND role IN ('user', 'assistant') `

  return {
    loadPayloads: `SELECT ${PAYLOAD_COLS} FROM session_messages WHERE session_id = ${d.param(1)} ORDER BY idx`,
    // Newest rows only, back in order: the subquery picks them, the outer sort restores idx order.
    loadPayloadTail:
      `SELECT ${PAYLOAD_COLS} FROM (SELECT idx, ${PAYLOAD_COLS} FROM session_messages ` +
      `WHERE session_id = ${d.param(1)} ORDER BY idx DESC LIMIT ${d.param(2)}) AS tail ORDER BY idx`,
    loadTranscriptNewest: `${head}${roles}ORDER BY idx DESC LIMIT ${d.param(2)}`,
    loadTranscriptBefore: `${head}${roles}AND idx < ${d.param(2)} ORDER BY idx DESC LIMIT ${d.param(3)}`,
  }
}

type ClaimSql = Pick<SessionSql, 'create' | 'insertIfAbsent' | 'claim' | 'selectOwner'>

// The four statements that decide who owns a session row.
function buildClaimSql(d: Dialect): ClaimSql {
  return {
    // A slash command needs the row to exist and be billable; it never displaces a run's claim.
    // How the last run ended stays: a command is not a run, and `/continue` reads it. The next
    // claim clears it.
    create:
      `INSERT INTO sessions (id, agent_id, user_id, channel, chat_id, status, started_at, ` +
      `last_activity_at) VALUES (${d.paramList(5)}, 'active', ${d.param(6)}, ${d.param(7)}) ` +
      `ON CONFLICT (id) DO UPDATE SET status = 'active', ended_at = NULL, ` +
      `last_activity_at = excluded.last_activity_at ` +
      `WHERE sessions.active_run_id IS NULL`,
    insertIfAbsent:
      `INSERT INTO sessions (id, agent_id, user_id, channel, chat_id, status, started_at, ` +
      `last_activity_at) VALUES (${d.paramList(5)}, 'active', ${d.param(6)}, ${d.param(7)}) ` +
      `ON CONFLICT (id) DO NOTHING`,
    // Row-atomic: two claimants race on one UPDATE, and the loser matches zero rows.
    claim:
      `UPDATE sessions SET status = 'active', active_run_id = ${d.param(1)}, end_reason = NULL, ` +
      `error_message = NULL, ended_at = NULL, last_activity_at = ${d.param(2)} ` +
      `WHERE id = ${d.param(3)} AND (active_run_id IS NULL OR last_activity_at < ${d.param(4)})`,
    selectOwner: `SELECT active_run_id FROM sessions WHERE id = ${d.param(1)}`,
  }
}

type RemoveSql = Pick<
  SessionSql,
  'selectRun' | 'removeRoutes' | 'removeMessages' | 'detachAttempts' | 'remove'
>

function buildRemoveSql(d: Dialect): RemoveSql {
  return {
    selectRun: `SELECT active_run_id FROM sessions WHERE id = ${d.param(1)}`,
    removeRoutes: `DELETE FROM channel_state WHERE key LIKE ${d.param(1)} AND value = ${d.param(2)}`,
    removeMessages: `DELETE FROM session_messages WHERE session_id = ${d.param(1)}`,
    detachAttempts: detachAttemptsSql(`session_id = ${d.param(1)}`),
    remove: `DELETE FROM sessions WHERE id = ${d.param(1)}`,
  }
}

// llm_attempts carries no FK to sessions (see migration 000001): detaching is the deleting code's
// job, not a cascade's. message_idx is nulled alongside session_id because the CHECK constraint
// requires message_idx IS NULL whenever session_id IS NULL.
export function detachAttemptsSql(where: string): string {
  return `UPDATE llm_attempts SET session_id = NULL, message_idx = NULL WHERE ${where}`
}

type ClearSql = Pick<
  SessionSql,
  | 'countAll'
  | 'countByAgent'
  | 'countRunningAll'
  | 'countRunningByAgent'
  | 'clearRoutesAll'
  | 'clearRoutesByAgent'
  | 'clearMessagesAll'
  | 'clearMessagesByAgent'
  | 'detachAttemptsAll'
  | 'detachAttemptsByAgent'
  | 'clearAll'
  | 'clearByAgent'
>

function buildClearSql(d: Dialect): ClearSql {
  return {
    countAll: 'SELECT COUNT(*) AS n FROM sessions',
    countByAgent: `SELECT COUNT(*) AS n FROM sessions WHERE agent_id = ${d.param(1)}`,
    countRunningAll: 'SELECT COUNT(*) AS n FROM sessions WHERE active_run_id IS NOT NULL',
    countRunningByAgent: `SELECT COUNT(*) AS n FROM sessions WHERE active_run_id IS NOT NULL AND agent_id = ${d.param(1)}`,
    clearRoutesAll:
      `DELETE FROM channel_state WHERE key LIKE ${d.param(1)} ` +
      'AND value IN (SELECT id FROM sessions)',
    clearRoutesByAgent:
      `DELETE FROM channel_state WHERE key LIKE ${d.param(1)} ` +
      `AND value IN (SELECT id FROM sessions WHERE agent_id = ${d.param(2)})`,
    clearMessagesAll: 'DELETE FROM session_messages',
    clearMessagesByAgent:
      `DELETE FROM session_messages WHERE session_id IN ` +
      `(SELECT id FROM sessions WHERE agent_id = ${d.param(1)})`,
    detachAttemptsAll: detachAttemptsSql('session_id IN (SELECT id FROM sessions)'),
    detachAttemptsByAgent: detachAttemptsSql(
      `session_id IN (SELECT id FROM sessions WHERE agent_id = ${d.param(1)})`
    ),
    clearAll: 'DELETE FROM sessions',
    clearByAgent: `DELETE FROM sessions WHERE agent_id = ${d.param(1)}`,
  }
}

// The session page is picked first (`recent`), then the fold's GROUP BY runs only over those
// sessions' attempts -- an unfiltered GROUP BY session_id would scan the entire llm_attempts
// history on every listing. The LEFT JOIN keeps sessions with no attempts at zero.
function listRecentSql(d: Dialect): string {
  return (
    `WITH recent AS (SELECT id, agent_id, channel, status, last_activity_at FROM sessions ` +
    `ORDER BY last_activity_at DESC LIMIT ${d.param(1)}) ` +
    `SELECT r.id, r.agent_id, r.channel, r.status, r.last_activity_at, ` +
    `COALESCE(t.cost_nano_usd, 0) AS cost_nano_usd, ` +
    `COALESCE(t.input_tokens, 0) AS input_tokens, ` +
    `COALESCE(t.output_tokens, 0) AS output_tokens, ` +
    `COALESCE(t.model_calls, 0) AS model_calls ` +
    `FROM recent AS r LEFT JOIN (SELECT session_id, ${TOTALS_FOLD_COLS} FROM llm_attempts ` +
    `WHERE session_id IN (SELECT id FROM recent) GROUP BY session_id) AS t ON t.session_id = r.id ` +
    `ORDER BY r.last_activity_at DESC`
  )
}
