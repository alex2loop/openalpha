import { computed, effect, type ReadonlySignal, signal, untracked } from '@preact/signals'

import type { DeskQuote } from '@/web/scene/types'
import { keyOf, priceDisplayOf, quotesBlock } from '@/web/state/market'
import { formatPrice, PERCENT } from '@/web/text/figures'

/** The most prices one name's line keeps: the polls since the page opened. */
const MAX_TRAIL_POINTS = 60

const trails = signal<ReadonlyMap<string, readonly number[]>>(new Map())

/** The names the page's own quote poll returns, each with a line of at least two points; a name
 *  whose move the wire left out has no previous close to start from and is left out. */
export const liveQuotes: ReadonlySignal<readonly DeskQuote[]> = computed(() =>
  (quotesBlock.view.value.data?.quotes ?? []).flatMap((quote): DeskQuote[] => {
    const { changePct } = quote

    if (changePct === undefined) {
      return []
    }

    const close = quote.last / (1 + changePct / PERCENT)
    const polled = trails.value.get(keyOf(quote)) ?? [quote.last]
    const display = quote.kind === 'index' ? undefined : priceDisplayOf(quote.market)

    return [
      {
        label: `${quote.ticker} ${formatPrice(quote.last, display)}`,
        ticker: quote.ticker,
        market: quote.market,
        changePct,
        close,
        line: [close, ...polled],
      },
    ]
  })
)

/** Adds each new read of the page's quote poll to its names' lines; it asks for nothing itself.
 *  The returned stop releases the watch and empties the lines. */
export function startQuoteTrail(): () => void {
  let readAt: number | undefined

  const stop = effect(() => {
    const view = quotesBlock.view.value

    if (view.data === undefined || view.readAt === readAt) {
      return
    }

    readAt = view.readAt

    const held = untracked(() => trails.value)

    trails.value = new Map(
      view.data.quotes.map((quote) => {
        const key = keyOf(quote)

        return [key, [...(held.get(key) ?? []).slice(1 - MAX_TRAIL_POINTS), quote.last]]
      })
    )
  })

  return () => {
    stop()
    trails.value = new Map()
  }
}
