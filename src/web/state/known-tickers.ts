import { computed, type ReadonlySignal } from '@preact/signals'

import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { runs } from '@/web/state/live'
import { findQuote, heldPositions, watchedNames } from '@/web/state/market'
import { openView } from '@/web/state/panel'

const MAX_KNOWN_TICKERS = 500
const SEARCH_LIMIT = 5

/** The tickers the page can name as links: held, watched, or named by a run in flight. */
export const knownTickers: ReadonlySignal<ReadonlySet<string>> = computed(() => {
  const names = [
    ...heldPositions.value.map((position) => position.instrument.ticker),
    ...watchedNames.value.map((instrument) => instrument.ticker),
    ...runs.value.flatMap((run) => run.tickers),
  ]

  return new Set([...new Set(names)].slice(0, MAX_KNOWN_TICKERS))
})

/** Opens the card of `ticker`; a name seen only in prose finds its market first. */
export function openTicker(ticker: string, market?: string): void {
  const known = market ?? marketOfKnown(ticker)

  if (known !== undefined) {
    openView({ ticker, market: known })
    return
  }

  searchMarket(ticker).then(
    (found) => {
      if (found !== undefined) {
        openView({ ticker, market: found })
      }
    },
    // A name the search cannot place has no card to open; the click does nothing.
    () => undefined
  )
}

function marketOfKnown(ticker: string): string | undefined {
  const held = heldPositions.value.find((position) => position.instrument.ticker === ticker)
  const watched = watchedNames.value.find((instrument) => instrument.ticker === ticker)

  return (held?.instrument ?? watched ?? findQuote(ticker))?.market
}

async function searchMarket(ticker: string): Promise<string | undefined> {
  const answer = await getJson(ROUTES.instruments, { query: { q: ticker, limit: SEARCH_LIMIT } })

  return answer.matches.find((match) => match.instrument.ticker === ticker)?.instrument.market
}
