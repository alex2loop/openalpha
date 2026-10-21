import type { Dialect, DialectName } from '@/core/types/storage'
import type { MigrationUp } from '@/persistence/types'
import { sqlTextValues } from '@/persistence/sql/syntax'

// The 1.0.0 baseline is immutable, so its CHECK lists are written out here rather than read from
// the code contracts that share their names today; a later change to a contract is a new migration.
const PAIRING_MAX_PENDING = 50
const LLM_ATTEMPT_KINDS = ['turn', 'compaction', 'preference', 'external']
const PROVIDER_ATTEMPT_OUTCOMES = ['success', 'retry', 'fallback', 'terminal_failure']
const LLM_ERROR_CODES = [
  'transient',
  'rate',
  'auth',
  'timeout',
  'not_found',
  'context_overflow',
  'billing',
  'empty_response',
  'output_budget_exhausted',
  'response_too_large',
  'fatal',
]
const USAGE_SOURCES = ['provider', 'estimated']
const COST_SOURCES = [
  'provider_reported',
  'pricing_override',
  'pricing_subscription',
  'pricing_openrouter',
  'pricing_modelsdev',
  'pricing_local',
  'pricing_fallback',
]

// Consolidated initial schema. Every timestamp is epoch-ms BIGINT, never a native date type.
// Every internal-accounting USD amount owned by these tables (LLM cost, scheduler-run cost) is
// integer nano-USD (see persistence/money.ts), never a float -- these are always single-currency,
// process-computed figures, so an exact fixed-point representation is both possible and required.
// This does not extend to the trading ledger's multi-currency, operator-entered amounts added by
// migration 000002: those carry their own `currency` column and a native-unit float contract
// documented beside `ledger_entries` there.
//
// Column types are not dialect knobs: sqlite gives INTEGER affinity to any type name containing
// 'INT' and REAL affinity to one containing 'DOUB', so one literal spelling serves both engines.
const MEMORY_INDEXES: readonly string[] = [
  'CREATE INDEX IF NOT EXISTS idx_memory_expires ON memory_kv (expires_at) WHERE expires_at IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS idx_memory_user_accessed ON memory_kv (agent_id, user_id, last_accessed_at)',
  'CREATE INDEX IF NOT EXISTS idx_memory_deleted ON memory_kv (deleted_at) WHERE deleted_at IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS idx_memory_run ON memory_kv (run_id) WHERE run_id IS NOT NULL',
]

// sqlite mirrors memory_kv into an FTS5 virtual table via triggers; postgres uses a generated
// tsvector column, so it needs no pg_trgm extension.
const MEMORY_TABLES: Readonly<Record<DialectName, readonly string[]>> = {
  sqlite: [
    `CREATE TABLE IF NOT EXISTS memory_kv (
      agent_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      importance INTEGER NOT NULL CHECK (importance IN (0, 5)),
      source TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      deleted_at INTEGER,
      run_id TEXT,
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL,
      PRIMARY KEY (agent_id, user_id, key)
    )`,
    ...MEMORY_INDEXES,
    `CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      agent_id UNINDEXED, user_id UNINDEXED, key UNINDEXED, value, importance UNINDEXED,
      tokenize='trigram'
    )`,
    `CREATE TRIGGER IF NOT EXISTS memory_kv_after_insert AFTER INSERT ON memory_kv BEGIN
      INSERT INTO memory_fts(agent_id, user_id, key, value, importance)
      VALUES (NEW.agent_id, NEW.user_id, NEW.key, NEW.value, NEW.importance);
    END`,
    `CREATE TRIGGER IF NOT EXISTS memory_kv_after_delete AFTER DELETE ON memory_kv BEGIN
      DELETE FROM memory_fts
      WHERE agent_id = OLD.agent_id AND user_id = OLD.user_id AND key = OLD.key;
    END`,
    `CREATE TRIGGER IF NOT EXISTS memory_kv_after_update AFTER UPDATE ON memory_kv BEGIN
      DELETE FROM memory_fts
      WHERE agent_id = OLD.agent_id AND user_id = OLD.user_id AND key = OLD.key;
      INSERT INTO memory_fts(agent_id, user_id, key, value, importance)
      VALUES (NEW.agent_id, NEW.user_id, NEW.key, NEW.value, NEW.importance);
    END`,
  ],
  postgres: [
    `CREATE TABLE IF NOT EXISTS memory_kv (
      agent_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      importance INTEGER NOT NULL CHECK (importance IN (0, 5)),
      source TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      deleted_at BIGINT,
      run_id TEXT,
      expires_at BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      last_accessed_at BIGINT NOT NULL,
      search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', value)) STORED,
      PRIMARY KEY (agent_id, user_id, key)
    )`,
    ...MEMORY_INDEXES,
    'CREATE INDEX IF NOT EXISTS idx_memory_search_vector ON memory_kv USING gin (search_vector)',
  ],
}

// `sessions` holds identity + lifecycle; per-session usage totals are folded from the
// `llm_attempts` fact rows at read time — there is no stored projection to diverge from them.
const SESSION_TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      chat_id TEXT,
      active_run_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('active','done','stale')),
      end_reason TEXT,
      error_message TEXT,
      started_at BIGINT NOT NULL,
      last_activity_at BIGINT NOT NULL,
      ended_at BIGINT
    )`,
  'CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions (agent_id)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions (status)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions (last_activity_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_channel_activity ON sessions (channel, last_activity_at DESC)',

  `CREATE TABLE IF NOT EXISTS session_messages (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL CHECK (idx >= 0),
      run_id TEXT,
      role TEXT NOT NULL CHECK (role IN ('user','assistant','tool','system')),
      content TEXT NOT NULL,
      tool_call_id TEXT,
      reasoning_blocks TEXT,
      is_error INTEGER NOT NULL DEFAULT 0 CHECK (is_error IN (0, 1)),
      created_at BIGINT NOT NULL,
      PRIMARY KEY (session_id, idx)
    )`,
]

const CHANNEL_TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS bindings (
      channel TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (channel, chat_id)
    )`,

  `CREATE TABLE IF NOT EXISTS channel_state (
      channel TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (channel, key)
    )`,

  `CREATE TABLE IF NOT EXISTS channel_inbox (
      channel TEXT NOT NULL,
      update_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      accepted_at BIGINT NOT NULL,
      started_at BIGINT,
      claim_token TEXT,
      completed_at BIGINT,
      error TEXT,
      PRIMARY KEY (channel, update_id)
    )`,
  'CREATE INDEX IF NOT EXISTS channel_inbox_pending ON channel_inbox (channel, status, accepted_at)',

  `CREATE TABLE IF NOT EXISTS pairings (
      code TEXT PRIMARY KEY,
      channel TEXT,
      chat_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved')),
      created_at BIGINT NOT NULL,
      approved_at BIGINT,
      pending_slot INTEGER CHECK (
        pending_slot IS NULL OR (pending_slot >= 0 AND pending_slot < ${PAIRING_MAX_PENDING})
      )
    )`,
  `CREATE INDEX IF NOT EXISTS idx_pairings_channel_chat_approved
      ON pairings (channel, chat_id) WHERE status = 'approved'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_pairings_channel_chat_pending
      ON pairings (channel, chat_id) WHERE status = 'pending'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_pairings_channel_slot_pending
      ON pairings (channel, pending_slot) WHERE status = 'pending'`,
]

// A row means paused: a switch the operator turns, never a schedule. Read per run, so a pause from
// the CLI reaches a running daemon at once.
const AGENT_PAUSE_TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS agent_pauses (
    agent_id TEXT PRIMARY KEY,
    paused_at BIGINT NOT NULL
  )`,
]

// Agent social networks: what the operator added, which agents joined, what they wrote and what
// waits for the operator. Pinned skill files and keys live on disk under the data dir, not here.
const SOCIAL_TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS social_networks (
    name TEXT PRIMARY KEY,
    state TEXT NOT NULL CHECK (state IN ('active', 'paused')),
    pause_reason TEXT CHECK (pause_reason IN ('operator', 'pin-mismatch')),
    added_at BIGINT NOT NULL,
    changed_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS social_memberships (
    agent_id TEXT NOT NULL,
    network TEXT NOT NULL,
    public_name TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('active', 'paused', 'refused')),
    review_all INTEGER NOT NULL DEFAULT 0,
    interval_ms BIGINT,
    forbidden_streak INTEGER NOT NULL DEFAULT 0,
    cooldown_until BIGINT,
    joined_at BIGINT NOT NULL,
    changed_at BIGINT NOT NULL,
    PRIMARY KEY (agent_id, network)
  )`,
  `CREATE TABLE IF NOT EXISTS social_writes (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    network TEXT NOT NULL,
    label TEXT NOT NULL,
    body_hash TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    returned_id TEXT,
    at BIGINT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS social_writes_scope ON social_writes (agent_id, network, at)',
  `CREATE TABLE IF NOT EXISTS social_drafts (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    network TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    query TEXT,
    body TEXT,
    reason TEXT NOT NULL CHECK (reason IN ('dm', 'delete', 'outside-link', 'review-all')),
    pin_id TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL
  )`,
]

const JOB_TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        allowed_tools TEXT,
        schedule_kind TEXT NOT NULL CHECK (schedule_kind IN ('cron','interval','once')),
      cron_expr TEXT,
      cron_tz TEXT,
      every_ms BIGINT,
      run_at BIGINT,
      next_run_at BIGINT NOT NULL,
      target_channel TEXT,
      target_chat_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      user_id TEXT,
      channel TEXT,
      chat_id TEXT,
      run_now_token TEXT,
      run_now_claimed_at BIGINT,
      created_at BIGINT NOT NULL,
      CHECK (
        (schedule_kind = 'cron' AND cron_tz IS NOT NULL) OR
        (schedule_kind <> 'cron' AND cron_tz IS NULL)
      ),
      CHECK (
        (user_id IS NULL AND channel IS NULL AND chat_id IS NULL) OR
        (user_id IS NOT NULL AND channel IS NOT NULL AND chat_id IS NOT NULL)
      ),
      CHECK (
        (run_now_token IS NULL AND run_now_claimed_at IS NULL) OR
        (run_now_token IS NOT NULL AND run_now_claimed_at IS NOT NULL)
      )
    )`,
  'CREATE INDEX IF NOT EXISTS idx_jobs_enabled_next ON jobs (enabled, next_run_at)',
]

const HEARTBEAT_TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS heartbeat_task_completions (
      agent_id TEXT NOT NULL,
      task_name TEXT NOT NULL,
      last_completed_at BIGINT NOT NULL CHECK (last_completed_at >= 0),
      lease_token TEXT,
      lease_started_at BIGINT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      next_retry_at BIGINT,
      PRIMARY KEY (agent_id, task_name)
    )`,

  `CREATE TABLE IF NOT EXISTS heartbeat_commitments (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      task_name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      due_at BIGINT NOT NULL CHECK (due_at >= 0),
      created_at BIGINT NOT NULL CHECK (created_at >= 0)
    )`,
  'CREATE INDEX IF NOT EXISTS idx_heartbeat_commitments_due ON heartbeat_commitments (agent_id, task_name, due_at)',
]

// `session_id` carries no foreign key: it records which session authorised the spend, and a slash
// command can pay before any agent run writes that session's row. A reference would either reject
// the write or silently drop the attribution, and the ledger may lose neither. Because there is no
// cascade, `SessionStore.remove` (stores/session/store.ts) is the one place that detaches these
// rows on session deletion -- nulling session_id and message_idx explicitly, in the same
// transaction as the delete -- which is the contract `persistence/types.ts` documents on
// `SessionStore.remove`.
const LLM_ATTEMPT_TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS llm_attempts (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      run_id TEXT NOT NULL,
      parent_run_id TEXT,
      agent_id TEXT NOT NULL,
      billing_agent_id TEXT NOT NULL DEFAULT '',
      message_idx INTEGER CHECK (message_idx IS NULL OR message_idx >= 0),
      kind TEXT NOT NULL CHECK (kind IN (${sqlTextValues(LLM_ATTEMPT_KINDS)})),
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK (
        outcome IN (${sqlTextValues(PROVIDER_ATTEMPT_OUTCOMES)})
      ),
      error_code TEXT CHECK (
        error_code IS NULL OR error_code IN (${sqlTextValues(LLM_ERROR_CODES)})
      ),
      usage_source TEXT NOT NULL CHECK (usage_source IN (${sqlTextValues(USAGE_SOURCES)})),
      cost_source TEXT NOT NULL CHECK (
        cost_source IN (${sqlTextValues(COST_SOURCES)})
      ),
      input_tokens BIGINT NOT NULL CHECK (input_tokens >= 0),
      output_tokens BIGINT NOT NULL CHECK (output_tokens >= 0),
      cache_read_tokens BIGINT NOT NULL CHECK (cache_read_tokens >= 0),
      cache_write_tokens BIGINT NOT NULL CHECK (cache_write_tokens >= 0),
      reasoning_tokens BIGINT NOT NULL CHECK (reasoning_tokens >= 0),
      cost_nano_usd BIGINT NOT NULL CHECK (cost_nano_usd >= 0),
      latency_ms BIGINT NOT NULL CHECK (latency_ms >= 0),
      settled_at BIGINT NOT NULL CHECK (settled_at >= 0),
      CHECK ((outcome = 'success') = (error_code IS NULL)),
      CHECK (message_idx IS NULL OR session_id IS NOT NULL),
      CHECK (message_idx IS NULL OR kind = 'turn')
    )`,
  'CREATE INDEX IF NOT EXISTS idx_llm_attempts_settled_at ON llm_attempts (settled_at)',
  'CREATE INDEX IF NOT EXISTS idx_llm_attempts_session_time ON llm_attempts (session_id, settled_at)',
  'CREATE INDEX IF NOT EXISTS idx_llm_attempts_billing_agent_time ON llm_attempts (billing_agent_id, settled_at)',
]

function buildSchedulerRunTables(dialect: Dialect): readonly string[] {
  return [
    `CREATE TABLE IF NOT EXISTS scheduler_runs (
      id ${dialect.autoIncrementPk},
      job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
      scheduled_for BIGINT,
      claim_token TEXT,
      request_id TEXT,
      started_at BIGINT NOT NULL,
      ended_at BIGINT,
      status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
      summary TEXT,
      error_message TEXT,
      cost_nano_usd BIGINT NOT NULL DEFAULT 0,
      lease_until BIGINT,
      UNIQUE (job_id, scheduled_for),
      UNIQUE (job_id, request_id)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_scheduler_runs_job_started ON scheduler_runs (job_id, started_at DESC)',
  ]
}

export const up: MigrationUp = async (tx, dialect) => {
  for (const sql of [
    ...SESSION_TABLES,
    ...CHANNEL_TABLES,
    ...AGENT_PAUSE_TABLES,
    ...SOCIAL_TABLES,
    ...JOB_TABLES,
    ...buildSchedulerRunTables(dialect),
    ...HEARTBEAT_TABLES,
    ...LLM_ATTEMPT_TABLES,
    ...MEMORY_TABLES[dialect.name],
  ]) {
    await tx.execute(sql)
  }
}
