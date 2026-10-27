import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

import type { Locale } from '@/core/types/locale'
import { formatBytes } from '@/cli/ui/format'
import { readDirectoryNames } from '@/core/fs'
import { AGENT_RUN_DIR_NAME } from '@/core/security/agent-directories'
import { WORKSPACES_DIR_NAME } from '@/engine/api'
import { t } from '@/i18n'

import type { DoctorProbe } from './types'
import { checkLabel } from './labels'

/** Past this a shell's HOME holds more than caches the retention sweep ages out. */
const RUN_DIR_WARN_BYTES = 2 * 1024 ** 3
/** Bounds the walk; a directory this full is reported by what it reached, which is already a lot. */
const RUN_DIR_SCAN_ENTRIES = 50_000

/** One row per agent whose `run/` has grown past the threshold; none while every one is small. */
export async function probeRunDirectories(
  dataDir: string,
  locale: Locale
): Promise<readonly DoctorProbe[]> {
  const root = join(dataDir, WORKSPACES_DIR_NAME)
  const agents = await readDirectoryNames(root, RUN_DIR_SCAN_ENTRIES)

  if (agents.kind !== 'names') {
    return []
  }

  const rows: DoctorProbe[] = []

  for (const agent of agents.names) {
    const bytes = await bytesUpTo(join(root, agent, AGENT_RUN_DIR_NAME), RUN_DIR_WARN_BYTES)

    if (bytes > RUN_DIR_WARN_BYTES) {
      rows.push({
        name: checkLabel(locale, 'data-dir'),
        status: 'warn',
        detail: t(locale, 'cli.doctorRunDirLarge', { agent, size: formatBytes(bytes) }),
      })
    }
  }

  return rows
}

/** Bytes under `dir`, walked without following a link, stopping once past `limit` or the entry
 *  budget. */
async function bytesUpTo(dir: string, limit: number): Promise<number> {
  const pending = [dir]
  let bytes = 0
  let entries = 0

  while (pending.length > 0 && bytes <= limit && entries < RUN_DIR_SCAN_ENTRIES) {
    const current = pending.pop() ?? dir
    const listed = await readDirectoryNames(current, RUN_DIR_SCAN_ENTRIES - entries).catch(
      () => undefined
    )

    if (listed?.kind !== 'names') {
      continue
    }

    for (const name of listed.names) {
      const path = join(current, name)
      const info = await lstat(path).catch(() => undefined)

      entries += 1

      if (info?.isDirectory() === true) {
        pending.push(path)
      } else if (info?.isFile() === true) {
        bytes += info.size
      }
    }
  }

  return bytes
}
