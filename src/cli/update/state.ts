import { join } from 'node:path'

import { z } from 'zod'

import type { ResolvedConfig } from '@/core/config/resolve'
import { BRAND } from '@/core/brand'
import { replacePrivateFileAtomic } from '@/core/security/private-files'
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_SECOND } from '@/core/utils/time'
import { compareVersions } from '@/core/utils/version'

import { isSourceCheckout, type LatestRead, readLatestRelease } from './release'

const STATE_FILE_NAME = 'update-check.json'
const CHECK_TIMEOUT_MS = 2 * MS_PER_SECOND
const CHECKED_FRESH_MS = MS_PER_DAY
const FAILED_FRESH_MS = MS_PER_HOUR

const updateStateSchema = z.strictObject({
  checkedAt: z.number().int().nonnegative(),
  latest: z.string().nullable(),
  failed: z.boolean(),
  notifiedAt: z.number().int().nonnegative(),
})

export type UpdateState = z.infer<typeof updateStateSchema>

const NEVER_CHECKED: UpdateState = Object.freeze({
  checkedAt: 0,
  latest: null,
  failed: false,
  notifiedAt: 0,
})

export async function isUpdateCheckEnabled(config: ResolvedConfig): Promise<boolean> {
  return config.update.check && !(await isSourceCheckout())
}

/** The cache is a hint, never an authority: missing, unreadable or malformed reads as never checked. */
export async function readUpdateState(dataDir: string): Promise<UpdateState> {
  try {
    const parsed = updateStateSchema.safeParse(await Bun.file(statePath(dataDir)).json())

    return parsed.success ? parsed.data : NEVER_CHECKED
  } catch {
    // Missing file or not JSON: the same as never checked.
    return NEVER_CHECKED
  }
}

export async function writeUpdateState(dataDir: string, state: UpdateState): Promise<void> {
  await replacePrivateFileAtomic({
    path: statePath(dataDir),
    content: `${JSON.stringify(state)}\n`,
  })
}

/** A failed read keeps the last known release, so going offline never hides a notice already due.
 *  The file is read after the fetch, not before: chat records a shown notice while this runs, and a
 *  copy read earlier would write that record away. An aborted caller records nothing. */
export async function refreshUpdateState(options: {
  readonly dataDir: string
  readonly now: number
  readonly signal?: AbortSignal
}): Promise<UpdateState> {
  const { dataDir, now, signal } = options
  const read = await readLatestWithin(signal)
  const previous = await readUpdateState(dataDir)

  if (signal?.aborted) {
    return previous
  }

  const next: UpdateState = read.reached
    ? { ...previous, checkedAt: now, failed: false, latest: read.latest }
    : { ...previous, checkedAt: now, failed: true }

  // An unwritable data dir must not fail an explicit check; the answer still serves this run.
  await writeUpdateState(dataDir, next).catch(() => undefined)

  return next
}

export function isUpdateStateFresh(state: UpdateState, now: number): boolean {
  const age = now - state.checkedAt
  const freshFor = state.failed ? FAILED_FRESH_MS : CHECKED_FRESH_MS

  return age >= 0 && age < freshFor
}

export function newerVersionOf(state: UpdateState): string | null {
  if (state.latest === null || compareVersions(state.latest, BRAND.version) <= 0) {
    return null
  }

  return state.latest
}

async function readLatestWithin(signal?: AbortSignal): Promise<LatestRead> {
  if (signal?.aborted) {
    return { reached: false }
  }

  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    return await readLatestRelease(controller.signal)
  } catch {
    // Offline, timed out or aborted: recorded as a failed check and retried after FAILED_FRESH_MS.
    return { reached: false }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

function statePath(dataDir: string): string {
  return join(dataDir, STATE_FILE_NAME)
}
