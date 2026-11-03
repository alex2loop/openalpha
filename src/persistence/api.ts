// Portable public API of persistence/: nothing here reaches a Bun or Node builtin, so the browser
// bundle can import it. Other modules import from here — never from persistence/ internals.
// Store factories are private except for consumer-owned interfaces bound by the composition root.
export type {
  PairingApproveResult,
  PairingRequestResult,
  PairingStore,
  PendingPairing,
  PollOffsetStore,
  SessionKey,
  SessionRouter,
} from '@/core/types/session'
export type { Dialect, DialectName, FtsSearch, Storage, Transaction } from '@/core/types/storage'
export type { OpenedPersistence } from '@/persistence/connection'
export type {
  BrowserSessionRow,
  BrowserSessionStore,
  LLMAttempt,
  LLMAttemptStore,
  Migration,
  MigrationDown,
  MigrationUp,
  NoticeRow,
  NoticeStore,
  RetentionConfig,
  RunLogRow,
  RunLogStore,
  SessionDetails,
  SessionIdResolution,
  SessionListing,
  SessionListQuery,
  SessionSnapshot,
  SessionStatus,
  SessionStore,
  SessionSummary,
  StoredSessionMessage,
  TranscriptMessage,
} from '@/persistence/types'
export { sqliteDialect } from '@/persistence/engines/sqlite-dialect'
export {
  DB_LOCK_NAME,
  type OpenSqliteWasmResult,
  openSqliteWasm,
  type SqliteWasmOptions,
} from '@/persistence/engines/sqlite-wasm'
export { SchemaAheadError, StorageFullError } from '@/persistence/errors'
export { MIGRATIONS } from '@/persistence/migrations/registry.generated'
export {
  hasTable,
  MIGRATION_IDS_SQL,
  MIGRATIONS_TABLE,
  type MigrateOptions,
  type MigrationRollbackResolution,
  type MigrationRollbackResult,
  type MigrationStatus,
  migrate,
  migrationStatus,
  POSTGRES_MIGRATIONS_TABLE_SQL,
  type RollbackMigrationOptions,
  resolveMigrationRollback,
  rollbackMigration,
  SQLITE_MIGRATIONS_TABLE_SQL,
} from '@/persistence/migrations/runner'
export { countRetention, type RetentionCounts, runRetention } from '@/persistence/retention'
export { effectiveHistoryDays } from '@/persistence/retention-history'
export { drainPages, RETENTION_DELETE_LIMIT } from '@/persistence/retention-pages'
export { createPersistenceProvider } from '@/persistence/services'
export { bindChunkSize } from '@/persistence/sql/syntax'
export { createChannelInbox } from '@/persistence/stores/channel/inbox'
export { stampLastMessages } from '@/persistence/stores/session/shown-rows'
export {
  ALL_TABLE_NAMES,
  ALL_TABLES,
  type DbTable,
  DURABLE_TABLES,
  dbTable,
  findTable,
  TABLE_NAME_WIDTH,
} from '@/persistence/tables'
export { optimizeSqlite } from '@/persistence/upkeep'
