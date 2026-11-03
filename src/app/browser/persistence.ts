import { z } from 'zod'

import type { StorageStatusResponse } from '@/app/server/wire/storage'
import type { App } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { ConfigOverrideStore } from '@/persistence/api'
import { formatErrForLog } from '@/core/security/credentials'

/** Where the browser's answer is kept: beside the visitor's other choices, in the database, so
 *  it is asked once and not again on every visit. */
const PERSISTENCE_SECTION = 'storage_persistence'

const RecordSchema = z.strictObject({ persisted: z.boolean() })

/** Asks the browser, once, to keep this origin's data through storage pressure, and records that it
 *  was asked and what it answered. A browser with no such request, or one asked on an earlier visit,
 *  is left alone. The wait for a visitor's answer ends with the app's signal, so closing the page
 *  never waits on a prompt. Never rejects: not being granted costs the visitor a reminder, not the
 *  page. */
export async function requestPersistence(app: App, logger: Logger): Promise<void> {
  try {
    const store = app.resolve('configOverrides')
    const storage = navigator.storage

    if (storage?.persist === undefined || (await readRecord(store, app.signal)) !== undefined) {
      return
    }

    const persisted = await untilAborted(storage.persist(), app.signal)

    if (persisted !== undefined) {
      await store.write(PERSISTENCE_SECTION, JSON.stringify({ persisted }), Date.now())
    }
  } catch (err: unknown) {
    if (!app.signal.aborted) {
      logger.warn('browser.persistence_failed', { err: formatErrForLog(err) })
    }
  }
}

/** What the browser says now, once it was asked: it may have granted later what it first refused.
 *  Null before the request was made. */
export async function readPersistence(
  store: ConfigOverrideStore,
  signal: AbortSignal
): Promise<StorageStatusResponse['persisted']> {
  const recorded = await readRecord(store, signal)

  if (recorded === undefined) {
    return null
  }

  const current = await navigator.storage?.persisted?.()

  return current ?? recorded
}

async function readRecord(
  store: ConfigOverrideStore,
  signal: AbortSignal
): Promise<boolean | undefined> {
  const payload = await store.read(PERSISTENCE_SECTION, signal)

  if (payload === undefined) {
    return undefined
  }

  try {
    const parsed = RecordSchema.safeParse(JSON.parse(payload))

    return parsed.success ? parsed.data.persisted : undefined
  } catch {
    // Not JSON: it reads as never asked, like any other payload that is not an answer.
    return undefined
  }
}

async function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  if (signal.aborted) {
    return undefined
  }

  const aborted = Promise.withResolvers<undefined>()
  const onAbort = (): void => aborted.resolve(undefined)

  signal.addEventListener('abort', onAbort, { once: true })

  try {
    return await Promise.race([work, aborted.promise])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
