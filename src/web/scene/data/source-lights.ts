import { computed, type ReadonlySignal, signal } from '@preact/signals'

import type { SourcesResponse } from '@/app/server/wire/market'
import { getJson } from '@/web/api/client'
import { startPoll } from '@/web/api/poll'
import { ROUTES } from '@/web/api/routes'

// A source's health moves with its calls; a few minutes is soon enough for the rack's lights.
const SOURCES_POLL_MS = 300_000

const sources = signal<SourcesResponse | undefined>(undefined)

/** The store's rack: one light a data source, `fresh` while it answers, `stale` once its last
 *  call failed or the daemon stopped calling it; empty until `/v1/sources` answers. */
export const sourceLights: ReadonlySignal<readonly ('fresh' | 'stale')[]> = computed(() =>
  (sources.value?.sources ?? []).map((source) =>
    source.breaker === 'open' || source.failure !== undefined ? 'stale' : 'fresh'
  )
)

/** Reads `/v1/sources` now and every `SOURCES_POLL_MS` while the scene is up. */
export function startSourceLights(): () => void {
  return startPoll(loadSources, SOURCES_POLL_MS)
}

// A failed read keeps the last good one; none before the first read leaves the rack steady.
async function loadSources(abortSignal: AbortSignal): Promise<void> {
  sources.value = await getJson(ROUTES.sources, { signal: abortSignal })
}
