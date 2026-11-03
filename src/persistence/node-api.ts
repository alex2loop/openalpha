// Bun/Node-only public API of persistence/: the sqlite and postgres engines, backups and restore.
// Only `app` and `cli` import it; the browser bundle never reaches this file.
export {
  BACKUPS_SUBDIR,
  backupAndPrune,
  backupSqlite,
  backupTarget,
  newestBackupAt,
} from '@/persistence/backup'
export { openPersistence, resetPersistence } from '@/persistence/connection'
export { restoreSqlite } from '@/persistence/engines/sqlite'
export { migrateWithBackup } from '@/persistence/pre-migration'
