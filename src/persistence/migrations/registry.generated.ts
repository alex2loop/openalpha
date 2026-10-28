// AUTO-GENERATED registry.generated.ts by scripts/gen-migrations.ts — do not edit.
// Every valid migration file is registered here in filename order; an exported down marks it reversible.

import type { Migration } from '@/persistence/types'
import * as migrationInitialSchema from '@/persistence/migrations/2026_07_10_000001_initial_schema'
import * as migrationTradingTables from '@/persistence/migrations/2026_07_10_000002_trading_tables'
import * as migrationMemoryFtsUpdateColumns from '@/persistence/migrations/2026_10_10_123605_memory_fts_update_columns'
import * as migrationAddChannelInboxAnswer from '@/persistence/migrations/2026_10_11_101208_add_channel_inbox_answer'
import * as migrationAddChannelInboxRetryAt from '@/persistence/migrations/2026_10_15_182559_add_channel_inbox_retry_at'
import * as migrationAddPairingsRevokedAt from '@/persistence/migrations/2026_10_19_164034_add_pairings_revoked_at'
import * as migrationAddQuarterlyAccountsCashFlowSource from '@/persistence/migrations/2026_10_21_142543_add_quarterly_accounts_cash_flow_source'
import * as migrationAddRuns from '@/persistence/migrations/2026_10_24_010135_add_runs'
import * as migrationAddNotices from '@/persistence/migrations/2026_10_24_012442_add_notices'
import * as migrationAddJobEventTriggers from '@/persistence/migrations/2026_10_24_052558_add_job_event_triggers'
import * as migrationAddSuggestionDebateModels from '@/persistence/migrations/2026_10_24_083308_add_suggestion_debate_models'
import * as migrationAddBrowserSessions from '@/persistence/migrations/2026_10_26_132705_add_browser_sessions'
import * as migrationAddRunsTickersQuestions from '@/persistence/migrations/2026_10_27_080926_add_runs_tickers_questions'
import * as migrationAddSessionMessagesDisplayOnly from '@/persistence/migrations/2026_10_28_223300_add_session_messages_display_only'
import * as migrationDropUnusedColumns from '@/persistence/migrations/2026_10_28_234503_drop_unused_columns'

export const MIGRATIONS = [
  { id: '2026_07_10_000001_initial_schema', reversibility: 'irreversible', up: migrationInitialSchema.up },
  { id: '2026_07_10_000002_trading_tables', reversibility: 'reversible', up: migrationTradingTables.up, down: migrationTradingTables.down },
  { id: '2026_10_10_123605_memory_fts_update_columns', reversibility: 'reversible', up: migrationMemoryFtsUpdateColumns.up, down: migrationMemoryFtsUpdateColumns.down },
  { id: '2026_10_11_101208_add_channel_inbox_answer', reversibility: 'reversible', up: migrationAddChannelInboxAnswer.up, down: migrationAddChannelInboxAnswer.down },
  { id: '2026_10_15_182559_add_channel_inbox_retry_at', reversibility: 'reversible', up: migrationAddChannelInboxRetryAt.up, down: migrationAddChannelInboxRetryAt.down },
  { id: '2026_10_19_164034_add_pairings_revoked_at', reversibility: 'reversible', up: migrationAddPairingsRevokedAt.up, down: migrationAddPairingsRevokedAt.down },
  { id: '2026_10_21_142543_add_quarterly_accounts_cash_flow_source', reversibility: 'reversible', up: migrationAddQuarterlyAccountsCashFlowSource.up, down: migrationAddQuarterlyAccountsCashFlowSource.down },
  { id: '2026_10_24_010135_add_runs', reversibility: 'reversible', up: migrationAddRuns.up, down: migrationAddRuns.down },
  { id: '2026_10_24_012442_add_notices', reversibility: 'reversible', up: migrationAddNotices.up, down: migrationAddNotices.down },
  { id: '2026_10_24_052558_add_job_event_triggers', reversibility: 'reversible', up: migrationAddJobEventTriggers.up, down: migrationAddJobEventTriggers.down },
  { id: '2026_10_24_083308_add_suggestion_debate_models', reversibility: 'reversible', up: migrationAddSuggestionDebateModels.up, down: migrationAddSuggestionDebateModels.down },
  { id: '2026_10_26_132705_add_browser_sessions', reversibility: 'reversible', up: migrationAddBrowserSessions.up, down: migrationAddBrowserSessions.down },
  { id: '2026_10_27_080926_add_runs_tickers_questions', reversibility: 'reversible', up: migrationAddRunsTickersQuestions.up, down: migrationAddRunsTickersQuestions.down },
  { id: '2026_10_28_223300_add_session_messages_display_only', reversibility: 'reversible', up: migrationAddSessionMessagesDisplayOnly.up, down: migrationAddSessionMessagesDisplayOnly.down },
  { id: '2026_10_28_234503_drop_unused_columns', reversibility: 'reversible', up: migrationDropUnusedColumns.up, down: migrationDropUnusedColumns.down },
] as const satisfies readonly Migration[]
