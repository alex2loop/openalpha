import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import type { InstrumentSearchResponse } from '@/app/server/wire/market'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'

const INSTRUMENT_DEBOUNCE_MS = 200
const MAX_TICKER_MATCHES = 5

export type Match = InstrumentSearchResponse['matches'][number]

// Waits out the typing, then asks; the previous request is aborted and so is one in flight on unmount.
export function useTickerMatches(query: string | undefined): readonly Match[] {
  const matches = useSignal<readonly Match[]>([])

  useEffect(() => {
    matches.value = []

    if (query === undefined) {
      return undefined
    }

    const controller = new AbortController()
    const timer = setTimeout(() => {
      getJson(ROUTES.instruments, {
        query: { q: query, limit: MAX_TICKER_MATCHES },
        signal: controller.signal,
      }).then(
        (answer) => {
          matches.value = answer.matches.slice(0, MAX_TICKER_MATCHES)
        },
        // A failed search lists no tickers, and an abort is this effect's own; the box still sends.
        () => undefined
      )
    }, INSTRUMENT_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  return matches.value
}
