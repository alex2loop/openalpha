import type { RunTimelineWire } from '@/app/server/wire/live'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { setCapped } from '@/web/state/capped-map'

const RUN_TIMELINE_CACHE_MAX = 20

// By run id. Only a read that holds the run's own row is kept: the run has ended, so nothing about
// it changes again.
const cache = new Map<string, RunTimelineWire>()

/** Who worked on a run and when. A read that holds the run's row is final and kept; any other read
 *  (the run still going, or its row not yet written) is served fresh. */
export async function loadTimeline(runId: string, abort: AbortSignal): Promise<RunTimelineWire> {
  const held = cache.get(runId)

  if (held !== undefined) {
    return held
  }

  const read = await getJson(ROUTES.runTimeline(runId), { signal: abort })

  if (read.run !== undefined) {
    setCapped(cache, [runId, read], RUN_TIMELINE_CACHE_MAX)
  }

  return read
}
