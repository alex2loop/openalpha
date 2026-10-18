import { join } from 'node:path'

import { z } from 'zod'

import type { ResolvedConfig } from '@/core/config/resolve'
import { BRAND } from '@/core/brand'
import { replacePrivateFileAtomic } from '@/core/security/private-files'
import { LOCALES } from '@/core/types/locale'
import { MS_PER_HOUR, MS_PER_SECOND } from '@/core/utils/time'
import { compareVersions } from '@/core/utils/version'

import type { ReleaseNote } from './changelog'
import { isSourceCheckout, readLatestRelease, readReleaseNotes } from './release'

const STATE_FILE_NAME = 'update-check.json'
const CHECK_TIMEOUT_MS = 2 * MS_PER_SECOND
const NOTES_TIMEOUT_MS = 3 * MS_PER_SECOND
const CHECKED_FRESH_MS = 12 * MS_PER_HOUR
const FAILED_FRESH_MS = MS_PER_HOUR

const releaseNoteSchema = z.object({
  version: z.string(),
  important: z.boolean(),
  summary: z.partialRecord(z.enum(LOCALES), z.string()),
})

const pendingUpgradeSchema = z.object({
  from: z.string(),
  to: z.string(),
  requestedAt: z.number().int().nonnegative(),
  target: z.object({ channel: z.string(), chatId: z.string() }).optional(),
})

// Every field after `notifiedAt` has a default so a file written by v1.0.5 still parses.
const updateStateSchema = z.strictObject({
  checkedAt: z.number().int().nonnegative(),
  latest: z.string().nullable(),
  failed: z.boolean(),
  notifiedAt: z.number().int().nonnegative(),
  releases: z.array(releaseNoteSchema).default([]),
  chatNotifiedAt: z.number().int().nonnegative().default(0),
  announcedVersion: z.string().nullable().default(null),
  chatAnnouncedVersion: z.string().nullable().default(null),
  pendingUpgrade: pendingUpgradeSchema.nullable().default(null),
  rolledBackVersion: z.string().nullable().default(null),
})

export type UpdateState = z.infer<typeof updateStateSchema>

export type PendingUpgrade = z.infer<typeof pendingUpgradeSchema>

const NEVER_CHECKED: UpdateState = Object.freeze({
  checkedAt: 0,
  latest: null,
  failed: false,
  notifiedAt: 0,
  releases: [],
  chatNotifiedAt: 0,
  announcedVersion: null,
  chatAnnouncedVersion: null,
  pendingUpgrade: null,
  rolledBackVersion: null,
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
  const read = await readWithin((within) => readLatestRelease(within), {
    timeoutMs: CHECK_TIMEOUT_MS,
    signal,
  })
  const previous = await readUpdateState(dataDir)

  if (signal?.aborted) {
    return previous
  }

  if (read === null || !read.reached) {
    return await saveRefreshed(dataDir, { ...previous, checkedAt: now, failed: true })
  }

  const releases = await readNotesFor(read.latest, previous, signal)

  return await saveRefreshed(dataDir, {
    ...previous,
    checkedAt: now,
    failed: false,
    latest: read.latest,
    releases,
  })
}

/** The cache while it is fresh, the release feed otherwise, so asking often costs two requests a day. */
export async function readFreshUpdateState(
  dataDir: string,
  options: { readonly now: number; readonly signal?: AbortSignal }
): Promise<UpdateState> {
  const cached = await readUpdateState(dataDir)

  if (isUpdateStateFresh(cached, options.now)) {
    return cached
  }

  return await refreshUpdateState({ dataDir, ...options })
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

async function readWithin<T>(
  read: (signal: AbortSignal) => Promise<T>,
  options: { readonly timeoutMs: number; readonly signal?: AbortSignal | undefined }
): Promise<T | null> {
  const { timeoutMs, signal } = options

  if (signal?.aborted) {
    return null
  }

  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    return await read(controller.signal)
  } catch {
    // Offline, timed out or aborted: the caller records a failed read and retries later.
    return null
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** An unreadable or empty notes read keeps what was known; the next refresh asks again. */
async function readNotesFor(
  latest: string | null,
  previous: UpdateState,
  signal?: AbortSignal
): Promise<UpdateState['releases']> {
  if (
    latest === null ||
    compareVersions(latest, BRAND.version) <= 0 ||
    latest === previous.releases[0]?.version
  ) {
    return previous.releases
  }

  const notes = await readWithin((within) => readReleaseNotes(latest, within), {
    timeoutMs: NOTES_TIMEOUT_MS,
    signal,
  })

  if (notes === null) {
    return previous.releases
  }

  return notes.filter((note) => compareVersions(note.version, BRAND.version) >= 0)
}

// An unwritable data dir must not fail an explicit check; the answer still serves this run.
async function saveRefreshed(dataDir: string, next: UpdateState): Promise<UpdateState> {
  await writeUpdateState(dataDir, next).catch(() => undefined)

  return next
}

/** The notes newer than the running version up to the latest release, newest first. */
export function releasesBehind(state: UpdateState): readonly ReleaseNote[] {
  const { latest } = state

  if (latest === null) {
    return []
  }

  return state.releases.filter(
    (note) =>
      compareVersions(note.version, BRAND.version) > 0 && compareVersions(note.version, latest) <= 0
  )
}

export function releaseNoteOf(state: UpdateState, version: string): ReleaseNote | null {
  return state.releases.find((note) => note.version === version) ?? null
}

function statePath(dataDir: string): string {
  return join(dataDir, STATE_FILE_NAME)
}
