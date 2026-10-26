import { computed, signal } from '@preact/signals'

import type { UpdateResponse } from '@/app/server/wire/system'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { readStorage, writeStorage } from '@/web/state/storage'

const DISMISSED_KEY = 'office.updateDismissed'

const dismissed = signal<string | undefined>(readStorage('local', DISMISSED_KEY))
let reading: Promise<void> | undefined

/** The last good `GET /v1/update`; a failed read keeps it. */
export const update = signal<UpdateResponse | undefined>(undefined)

/** A newer release is out and the operator has not put it off in this browser. */
export const isUpdateShown = computed(() => {
  const answer = update.value

  return (
    answer?.enabled && answer.newer && answer.latest !== null && !isUpdateDismissed(answer.latest)
  )
})

/** Reads the release status; a call while one runs shares it. */
export function loadUpdate(abortSignal: AbortSignal): Promise<void> {
  reading ??= readUpdate(abortSignal).finally(() => {
    reading = undefined
  })

  return reading
}

/** Starts the read the page makes once it is signed in; the returned stop aborts it. */
export function startUpdate(): () => void {
  const controller = new AbortController()

  loadUpdate(controller.signal).catch(() => undefined)

  return () => controller.abort()
}

function isUpdateDismissed(version: string): boolean {
  return dismissed.value === version
}

/** Hides the notice for `version` in this browser; a later release shows it again. */
export function dismissUpdate(version: string): void {
  dismissed.value = version
  writeStorage('local', DISMISSED_KEY, version)
}

// The notice can wait for the next read, so a failure, the caller's abort among them, is dropped.
async function readUpdate(abortSignal: AbortSignal): Promise<void> {
  try {
    update.value = await getJson(ROUTES.update, { signal: abortSignal })
  } catch {
    // The last answer stays.
  }
}
