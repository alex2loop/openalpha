import type { Storage } from '@/core/types/storage'

/** SQLite recommends `PRAGMA optimize` periodically on a connection that lives long. It lives here,
 *  beside the backup's `VACUUM INTO`, so no store or domain code learns the dialect. */
export async function optimizeSqlite(db: Storage): Promise<void> {
  await db.execute('PRAGMA optimize')
}
