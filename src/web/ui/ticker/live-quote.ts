import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import type { TradingQuoteWire, TradingWireCaveat } from '@/app/server/wire/trading'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { createSingleFlight } from '@/web/api/single-flight'
import { noteQuoteLevel } from '@/web/state/market'
import { toCaveatText } from '@/web/text/caveat-text'
import { toErrorText, tr } from '@/web/text/tr'

export interface LiveQuote {
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
          failure.value = unquotedText(answer.caveats)
          return
        }

        quote.value = found
        noteQuoteLevel(found)
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

/** The daemon's reason for answering without the name's price, else the page's own line. */
function unquotedText(caveats: readonly TradingWireCaveat[]): string {
  const [first] = caveats

  return first === undefined ? tr('ui.office.ticker.refreshNone') : toCaveatText(first)
}
