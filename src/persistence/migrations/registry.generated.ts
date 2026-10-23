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

export const MIGRATIONS = [
  { id: '2026_07_10_000001_initial_schema', reversibility: 'irreversible', up: migrationInitialSchema.up },
  { id: '2026_07_10_000002_trading_tables', reversibility: 'reversible', up: migrationTradingTables.up, down: migrationTradingTables.down },
  { id: '2026_10_10_123605_memory_fts_update_columns', reversibility: 'reversible', up: migrationMemoryFtsUpdateColumns.up, down: migrationMemoryFtsUpdateColumns.down },
  { id: '2026_10_11_101208_add_channel_inbox_answer', reversibility: 'reversible', up: migrationAddChannelInboxAnswer.up, down: migrationAddChannelInboxAnswer.down },
  { id: '2026_10_15_182559_add_channel_inbox_retry_at', reversibility: 'reversible', up: migrationAddChannelInboxRetryAt.up, down: migrationAddChannelInboxRetryAt.down },
  { id: '2026_10_19_164034_add_pairings_revoked_at', reversibility: 'reversible', up: migrationAddPairingsRevokedAt.up, down: migrationAddPairingsRevokedAt.down },
  { id: '2026_10_21_142543_add_quarterly_accounts_cash_flow_source', reversibility: 'reversible', up: migrationAddQuarterlyAccountsCashFlowSource.up, down: migrationAddQuarterlyAccountsCashFlowSource.down },
  { id: '2026_10_24_010135_add_runs', reversibility: 'reversible', up: migrationAddRuns.up, down: migrationAddRuns.down },
] as const satisfies readonly Migration[]
