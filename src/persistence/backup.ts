import { chmod, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { Storage } from '@/core/types/storage'
import { PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE } from '@/core/security/private-files'

const BACKUP_EXT = '.db'
const PARTIAL_EXT = '.part'
const KEEP_BACKUPS = 7

export const BACKUPS_SUBDIR = 'backups'

export function backupTarget(dir: string): string {
  return join(dir, `${new Date().toISOString().replaceAll(':', '-')}${BACKUP_EXT}`)
}

// Written aside and renamed last, so a crash mid-write never leaves a half-written `.db`
// behind that occupies a retention slot.
export async function backupSqlite(db: Storage, target: string): Promise<void> {
  const partial = `${target}${PARTIAL_EXT}`

  await mkdir(dirname(target), { recursive: true, mode: PRIVATE_DIRECTORY_MODE })

  try {
    // VACUUM INTO takes a string literal, not a bind parameter, so quote-doubling is the escape.
    await db.execute(`VACUUM INTO '${partial.replaceAll("'", "''")}'`)
    // VACUUM INTO honours the umask, not a mode argument, so the whole database would otherwise
    // land group- and world-readable wherever `--path` points.
    await chmod(partial, PRIVATE_FILE_MODE)
    await rename(partial, target)
  } catch (err: unknown) {
    await removeQuietly(partial)
    throw err
  }
}

export async function pruneBackups(dir: string): Promise<void> {
  const names = await readdir(dir)

  for (const orphan of names.filter((name) => name.endsWith(PARTIAL_EXT))) {
    await removeQuietly(join(dir, orphan))
  }

  const files = names.filter((name) => name.endsWith(BACKUP_EXT)).sort()

  for (const stale of files.slice(0, Math.max(0, files.length - KEEP_BACKUPS))) {
    await rm(join(dir, stale), { force: true })
  }
}

async function removeQuietly(path: string): Promise<void> {
  await rm(path, { force: true }).catch(() => undefined)
}
