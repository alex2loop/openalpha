import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import type { CliApp } from '@/cli/types'
import type { ResolvedConfig } from '@/core/config/resolve'
import { BRAND } from '@/core/brand'
import { DEGRADED_KINDS, type DegradedEntry } from '@/core/container'
import { replacePrivateFileAtomic } from '@/core/security/private-files'

/** What a daemon started without, worded once in its own language so any reader prints it as is. */
const DEGRADED_ENTRY: z.ZodType<DegradedEntry> = z.object({
  kind: z.enum(DEGRADED_KINDS),
  subject: z.string(),
  message: z.string(),
  variables: z.array(z.string()).readonly().exactOptional(),
})
const READY_STATE = z.object({ pid: z.number(), degraded: z.array(DEGRADED_ENTRY) })

export function readyFilePath(app: { readonly config: Pick<ResolvedConfig, 'paths'> }): string {
  return join(app.config.paths.dataDir, BRAND.readyFile)
}

/** Written once boot has opened every subsystem, so a background start can tell a daemon that is
 *  up and answering from one still loading data. It also carries what the daemon started without,
 *  which `status` and `/v1/health` read back. */
export async function writeReadyFile(
  app: CliApp,
  degraded: readonly DegradedEntry[]
): Promise<void> {
  const state = { pid: process.pid, degraded }

  // Atomic: `status` and a waiting background start poll it, and must never read half a file.
  await replacePrivateFileAtomic({ path: readyFilePath(app), content: JSON.stringify(state) })
}

/** Cleared as a start claims the pid file: a daemon that died hard leaves its file behind, and a
 *  reused pid would otherwise read as ready before this one has booted. */
export async function clearReadyFile(app: CliApp): Promise<void> {
  await rm(readyFilePath(app), { force: true })
}

/** Only a file naming this pid counts, so one a dead daemon left behind never reads as ready. */
export async function isDaemonReady(app: CliApp, pid: number): Promise<boolean> {
  return (await readReadyState(app, pid)) !== undefined
}

/** What the daemon with this pid started without; empty when it is not ready or wrote no file. */
export async function readDaemonDegraded(
  app: { readonly config: Pick<ResolvedConfig, 'paths'> },
  pid: number
): Promise<readonly DegradedEntry[]> {
  return (await readReadyState(app, pid))?.degraded ?? []
}

async function readReadyState(
  app: { readonly config: Pick<ResolvedConfig, 'paths'> },
  pid: number
): Promise<z.infer<typeof READY_STATE> | undefined> {
  try {
    const parsed = READY_STATE.safeParse(JSON.parse(await readFile(readyFilePath(app), 'utf8')))

    return parsed.success && parsed.data.pid === pid ? parsed.data : undefined
  } catch {
    // Absent, unreadable or not JSON (an older daemon wrote its bare pid): not ready yet.
    return undefined
  }
}
