import type { RunCallsWire } from '@/app/server/wire/live'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { setCapped } from '@/web/state/capped-map'

const RUN_CALLS_CACHE_MAX = 20

// By run id. Only a run that has ended is kept: its calls no longer change.
const cache = new Map<string, RunCallsWire>()

/** The calls of a run and everything beneath it. An ended run is read once and then served from
 *  the cache; a running one is read afresh, as it still makes calls. */
export async function loadCalls(
  runId: string,
  abort: AbortSignal,
  hasEnded: boolean
): Promise<RunCallsWire> {
  const held = hasEnded ? cache.get(runId) : undefined

  if (held !== undefined) {
    return held
  }

  const read = await getJson(ROUTES.runCalls(runId), { signal: abort })

  if (hasEnded) {
    setCapped(cache, [runId, read], RUN_CALLS_CACHE_MAX)
  }

  return read
}
