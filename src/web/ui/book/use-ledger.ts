import { type ReadonlySignal, useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import type { LedgerEntryWire } from '@/app/server/wire/money'
import { ApiFailure, getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'

const LEDGER_ROWS_MAX = 500

interface LedgerRead {
  readonly rows: ReadonlySignal<readonly LedgerEntryWire[]>
  readonly hasMore: ReadonlySignal<boolean>
  readonly isLoading: ReadonlySignal<boolean>
  readonly failure: ReadonlySignal<ApiFailure | undefined>
  /** Reads the next page, or tries the failed one again. */
  readonly loadMore: () => void
}

/** The ledger newest first, a page at a time as the daemon sizes it; what was read is kept to
 *  `LEDGER_ROWS_MAX`, and the read in flight ends with the component. */
export function useLedger(): LedgerRead {
  const rows = useSignal<readonly LedgerEntryWire[]>([])
  const cursor = useSignal<string | undefined>(undefined)
  const hasMore = useSignal(false)
  const isLoading = useSignal(true)
  const failure = useSignal<ApiFailure | undefined>(undefined)
  const inFlight = useRef<AbortController | undefined>(undefined)

  function loadMore(): void {
    const next = cursor.peek()
    const abort = new AbortController()

    inFlight.current?.abort()
    inFlight.current = abort
    isLoading.value = true
    getJson(ROUTES.ledger, {
      ...(next === undefined ? {} : { query: { cursor: next } }),
      signal: abort.signal,
    }).then(
      (page) => {
        rows.value = [...rows.peek(), ...page.entries].slice(0, LEDGER_ROWS_MAX)
        cursor.value = page.nextCursor
        hasMore.value = page.nextCursor !== undefined && rows.peek().length < LEDGER_ROWS_MAX
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
