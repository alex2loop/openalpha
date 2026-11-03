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

/** Asks the browser, once, to keep this origin's data through storage pressure, and records what it
 *  answered. A browser with no such request, or one that already answered on an earlier visit, is
 *  left alone. Never rejects: not being granted costs the visitor a reminder, not the page. */
export async function requestPersistence(app: App, logger: Logger): Promise<void> {
  const store = app.resolve('configOverrides')

  try {
    const storage = navigator.storage

    if (storage?.persist === undefined || (await readPersistence(store, app.signal)) !== null) {
      return
    }

    const persisted = await storage.persist()

    await store.write(PERSISTENCE_SECTION, JSON.stringify({ persisted }), Date.now())
  } catch (err: unknown) {
    logger.warn('browser.persistence_failed', { err: formatErrForLog(err) })
  }
}

/** The recorded answer, or null before the browser was asked. A row that no longer parses reads as
 *  never asked. */
export async function readPersistence(
  store: ConfigOverrideStore,
  signal: AbortSignal
): Promise<StorageStatusResponse['persisted']> {
  const payload = await store.read(PERSISTENCE_SECTION, signal)

  if (payload === undefined) {
    return null
  }

  try {
    const parsed = RecordSchema.safeParse(JSON.parse(payload))

    return parsed.success ? parsed.data.persisted : null
  } catch {
    // Not JSON: it reads as never asked, like any other payload that is not an answer.
    return null
  }
}
