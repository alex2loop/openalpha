import { chmod, mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import type { Logger } from '@/core/logging/logger'
import type { Storage } from '@/core/types/storage'
import { isErrno } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE } from '@/core/security/private-files'

const BACKUP_EXT = '.db'
const STAGING_PREFIX = '.staging-'
const KEEP_BACKUPS = 7

export const BACKUPS_SUBDIR = 'backups'

interface BackupAndPrune {
  readonly db: Storage
  /** From `backupTarget`, so a caller that fails can still name the file it was writing. */
  readonly target: string
  readonly logger: Logger
  readonly keep?: number
}

export function backupTarget(dir: string): string {
  return join(dir, `${new Date().toISOString().replaceAll(':', '-')}${BACKUP_EXT}`)
}

// Written into a private staging directory beside the target and renamed last: VACUUM INTO honours
// the umask, so the copy is unreadable to others from its first byte, and a crash mid-write never
// leaves a half-written `.db` that occupies a retention slot. Same filesystem, so the rename is
// atomic.
export async function backupSqlite(db: Storage, target: string): Promise<void> {
  const parent = dirname(target)

  await mkdir(parent, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })

  const staging = await mkdtemp(join(parent, STAGING_PREFIX))

  try {
    await chmod(staging, PRIVATE_DIRECTORY_MODE)

    const partial = join(staging, basename(target))

    // VACUUM INTO takes a string literal, not a bind parameter, so quote-doubling is the escape.
    await db.execute(`VACUUM INTO '${partial.replaceAll("'", "''")}'`)
    await chmod(partial, PRIVATE_FILE_MODE)
    await rename(partial, target)
  } finally {
    await removeQuietly(staging)
  }
}

/** Writes `target`, then drops the oldest copies beside it beyond `keep`. Only the copy can fail
 *  it: a failed prune leaves a good snapshot and one copy too many. */
export async function backupAndPrune(input: BackupAndPrune): Promise<void> {
  const { db, target, logger, keep } = input
  const dir = dirname(target)

  await backupSqlite(db, target)
  await pruneBackups(dir, keep).catch((err: unknown) => {
    logger.warn('backup.prune_failed', { path: dir, err: formatErrForLog(err) })
  })
}

/** The modification time of the newest backup in `dir` (names are ISO timestamps, so the last name
 *  is the newest); null when the directory is missing or holds none. */
export async function newestBackupAt(dir: string): Promise<number | null> {
  const names = await readdir(dir).catch((err: unknown) => {
    if (isErrno(err, 'ENOENT')) {
      return []
    }

    throw err
  })
  const newest = names
    .filter((name) => name.endsWith(BACKUP_EXT))
    .sort()
    .at(-1)

  if (newest === undefined) {
    return null
  }

  return (await stat(join(dir, newest))).mtimeMs
}

async function pruneBackups(dir: string, keep = KEEP_BACKUPS): Promise<void> {
  const names = await readdir(dir)

  for (const orphan of names.filter((name) => name.startsWith(STAGING_PREFIX))) {
    await removeQuietly(join(dir, orphan))
  }

  const files = names.filter((name) => name.endsWith(BACKUP_EXT)).sort()

  for (const stale of files.slice(0, Math.max(0, files.length - keep))) {
    await rm(join(dir, stale), { force: true })
  }
}

async function removeQuietly(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch(() => undefined)
}
