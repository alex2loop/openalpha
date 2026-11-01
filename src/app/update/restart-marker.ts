import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { isErrno } from '@/core/errors'
import { replacePrivateFileAtomic } from '@/core/security/private-files'
import { MS_PER_MINUTE } from '@/core/utils/time'

const MARKER_FILE = 'restart.json'
/** A marker older than this belongs to a restart that never finished, not to this boot. */
const RESTART_MARKER_MAX_AGE_MS = 10 * MS_PER_MINUTE

const markerSchema = z.object({ requestedAt: z.number().int().nonnegative() })

/** Replaced, not created: a marker an earlier restart left behind must never block the next one. */
export async function writeRestartMarker(dataDir: string, now: number): Promise<void> {
  await replacePrivateFileAtomic({
    path: markerPath(dataDir),
    content: `${JSON.stringify({ requestedAt: now })}\n`,
  })
}

export async function clearRestartMarker(dataDir: string): Promise<void> {
  await rm(markerPath(dataDir), { force: true })
}

/** Reads and deletes the marker, so one restart is announced once. True when it is recent. */
export async function takeRestartMarker(dataDir: string, now: number): Promise<boolean> {
  let text: string

  try {
    text = await readFile(markerPath(dataDir), 'utf8')
  } catch (err: unknown) {
    if (isErrno(err, 'ENOENT')) {
      return false
    }

    throw err
  }

  await clearRestartMarker(dataDir)

  const requestedAt = parseRequestedAt(text)

  if (requestedAt === undefined) {
    return false
  }

  const age = now - requestedAt

  return age >= 0 && age < RESTART_MARKER_MAX_AGE_MS
}

function parseRequestedAt(text: string): number | undefined {
  try {
    const parsed = markerSchema.safeParse(JSON.parse(text))

    return parsed.success ? parsed.data.requestedAt : undefined
  } catch {
    // Not JSON: a marker nobody can read is no restart to announce.
    return undefined
  }
}

function markerPath(dataDir: string): string {
  return join(dataDir, MARKER_FILE)
}
