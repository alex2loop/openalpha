import { chmod, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import type { Storage } from '@/core/types/storage'
import { PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE } from '@/core/security/private-files'

const BACKUP_EXT = '.db'
const STAGING_PREFIX = '.staging-'
const KEEP_BACKUPS = 7

export const BACKUPS_SUBDIR = 'backups'

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

export async function pruneBackups(dir: string): Promise<void> {
  const names = await readdir(dir)

  for (const orphan of names.filter((name) => name.startsWith(STAGING_PREFIX))) {
    await removeQuietly(join(dir, orphan))
  }

  const files = names.filter((name) => name.endsWith(BACKUP_EXT)).sort()

  for (const stale of files.slice(0, Math.max(0, files.length - KEEP_BACKUPS))) {
    await rm(join(dir, stale), { force: true })
  }
}

async function removeQuietly(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch(() => undefined)
}
