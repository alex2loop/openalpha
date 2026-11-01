import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import type { TradingQuoteWire } from '@/app/server/wire/trading'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { createSingleFlight } from '@/web/api/single-flight'
import { toErrorText, tr } from '@/web/text/tr'

interface LiveQuote {
  /** The last price read on request; absent until the operator asks. */
  readonly quote: TradingQuoteWire | undefined
  readonly failure: string | undefined
  readonly isBusy: boolean
  refresh(): void
}

/** One name's price read live from its sources on request, then `onRead` so the block reads its bars
 *  again. A price read: no model, no order. One read at a time; it ends with the mount. */
export function useLiveQuote(ticker: string, market: string, onRead: () => void): LiveQuote {
  const quote = useSignal<TradingQuoteWire | undefined>(undefined)
  const failure = useSignal<string | undefined>(undefined)
  const isBusy = useSignal(false)
  const flight = useRef<(() => Promise<void>) | undefined>(undefined)

  useEffect(() => {
    const lifetime = new AbortController()

    flight.current = createSingleFlight(async (signal) => {
      isBusy.value = true
      failure.value = undefined

      try {
        const answer = await getJson(ROUTES.quotes, { query: { market, ticker }, signal })
        const found = answer.quotes.find((row) => row.ticker === ticker && row.market === market)

        if (found === undefined) {
          failure.value = answer.caveats[0]?.text ?? tr('ui.office.ticker.refreshNone')
          return
        }

        quote.value = found
        onRead()
      } catch (error: unknown) {
        if (!signal.aborted) {
          failure.value = toErrorText(error)
        }
      } finally {
        isBusy.value = false
      }
    }, lifetime.signal)

    return () => {
      lifetime.abort()
      flight.current = undefined
    }
  }, [ticker, market])

  return {
    quote: quote.value,
    failure: failure.value,
    isBusy: isBusy.value,
    refresh: () => {
      flight.current?.().catch(() => undefined)
    },
  }
}
