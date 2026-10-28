import { type ReadonlySignal, useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import type { ResearchReportWire } from '@/app/server/wire/activity'
import { ApiFailure, getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'

const RESEARCH_READ = 20
const RESEARCH_ROWS_MAX = 100

interface ResearchRead {
  readonly rows: ReadonlySignal<readonly ResearchReportWire[]>
  readonly hasMore: ReadonlySignal<boolean>
  readonly isLoading: ReadonlySignal<boolean>
  readonly failure: ReadonlySignal<ApiFailure | undefined>
  /** Reads the next page, or tries the failed one again. */
  readonly loadMore: () => void
}

/** The finished research runs newest first, a page at a time; what was read is kept to
 *  `RESEARCH_ROWS_MAX`, and the read in flight ends with the component. */
export function useResearch(): ResearchRead {
  const rows = useSignal<readonly ResearchReportWire[]>([])
  const hasMore = useSignal(false)
  const isLoading = useSignal(true)
  const failure = useSignal<ApiFailure | undefined>(undefined)
  const inFlight = useRef<AbortController | undefined>(undefined)

  function loadMore(): void {
    const last = rows.peek().at(-1)
    const abort = new AbortController()

    inFlight.current?.abort()
    inFlight.current = abort
    isLoading.value = true
    getJson(ROUTES.research, {
      query:
        last === undefined
          ? { limit: RESEARCH_READ }
          : { before: last.endedAt, limit: RESEARCH_READ },
      signal: abort.signal,
    }).then(
      (page) => {
        rows.value = [...rows.peek(), ...page.reports].slice(0, RESEARCH_ROWS_MAX)
        // A page can hold fewer than asked for, so only an empty one ends the list.
        hasMore.value = page.reports.length > 0 && rows.peek().length < RESEARCH_ROWS_MAX
        failure.value = undefined
        isLoading.value = false
      },
      (error: unknown) => {
        // Anything but an `ApiFailure` is this component's own abort.
        if (error instanceof ApiFailure) {
          failure.value = error
          isLoading.value = false
        }
      }
    )
  }

  // One first read per mount, by design.
  useEffect(() => {
    loadMore()

    return () => inFlight.current?.abort()
  }, [])

  return { rows, hasMore, isLoading, failure, loadMore }
}
