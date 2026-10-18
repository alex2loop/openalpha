import { join } from 'node:path'

import { z } from 'zod'

import type { ResolvedConfig } from '@/core/config/resolve'
import { BRAND } from '@/core/brand'
import { replacePrivateFileAtomic } from '@/core/security/private-files'
import { LOCALES } from '@/core/types/locale'
import { MS_PER_HOUR, MS_PER_SECOND } from '@/core/utils/time'
import { compareVersions } from '@/core/utils/version'

import type { ReleaseNote } from './changelog'
import { isCompiledBinary, readLatestRelease, readReleaseNotes } from './release'

const STATE_FILE_NAME = 'update-check.json'
const CHECK_TIMEOUT_MS = 2 * MS_PER_SECOND
const NOTES_TIMEOUT_MS = 3 * MS_PER_SECOND
const CHECKED_FRESH_MS = 12 * MS_PER_HOUR
const FAILED_FRESH_MS = MS_PER_HOUR

// The one file every update writer shares; chained so read-then-write never interleaves.
let writeQueue: Promise<unknown> = Promise.resolve()

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

// Not strict: a field a later release adds is dropped rather than failing the file after a downgrade.
const updateStateSchema = z.object({
  checkedAt: z.number().int().nonnegative(),
  latest: z.string().nullable(),
  failed: z.boolean(),
  notifiedAt: z.number().int().nonnegative(),
  releases: z.array(releaseNoteSchema),
  chatNotifiedAt: z.number().int().nonnegative(),
  announcedVersion: z.string().nullable(),
  chatAnnouncedVersion: z.string().nullable(),
  pendingUpgrade: pendingUpgradeSchema.nullable(),
  rolledBackVersion: z.string().nullable(),
})

export type UpdateState = z.infer<typeof updateStateSchema>

export type PendingUpgrade = z.infer<typeof pendingUpgradeSchema>

type StatePatch = Partial<UpdateState>

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

/** Only a compiled release checks: a clone runs from git and updates with git. */
export function isUpdateCheckEnabled(config: ResolvedConfig): boolean {
  return config.update.check && isCompiledBinary()
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

/** Reads the file afresh and writes `patch` over it. Patches run one at a time in this process, so
 *  no writer drops a field another just wrote. A patch function sees the state it is applied to. */
export async function patchUpdateState(
  dataDir: string,
  patch: StatePatch | ((state: UpdateState) => StatePatch)
): Promise<UpdateState> {
  const run = writeQueue.then(async () => {
    const state = await readUpdateState(dataDir)
    const next = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }

    await replacePrivateFileAtomic({
      path: statePath(dataDir),
      content: `${JSON.stringify(next)}\n`,
    })

    return next
  })

  writeQueue = run.catch(() => undefined)

  return await run
}

/** A failed read keeps the last known release, so going offline never hides a notice already due.
 *  Only the fields read here are written, so a notice recorded during the fetch survives. An aborted
 *  caller records nothing. */
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
    return await saveRefreshed(dataDir, previous, { checkedAt: now, failed: true })
  }

  const releases = await readNotesFor(read.latest, previous, signal)

  if (signal?.aborted) {
    return previous
  }

  return await saveRefreshed(dataDir, previous, {
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
async function saveRefreshed(
  dataDir: string,
  previous: UpdateState,
  refreshed: StatePatch
): Promise<UpdateState> {
  return await patchUpdateState(dataDir, refreshed).catch(() => ({ ...previous, ...refreshed }))
}

/** The notes newer than the running version up to the latest release, newest first. Empty while the
 *  notes stop short of the latest release (their read failed): a count, an important flag or a
 *  summary from an older release would misdescribe the newest one. */
export function releasesBehind(state: UpdateState): readonly ReleaseNote[] {
  const { latest } = state

  if (latest === null || state.releases[0]?.version !== latest) {
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
