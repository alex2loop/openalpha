import { computed, type ReadonlySignal, signal } from '@preact/signals'

import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { runs } from '@/web/state/live'
import { findQuote, heldPositions, watchedNames } from '@/web/state/market'
import { collapsed, openView, type PanelView, panelView } from '@/web/state/panel'
import { toErrorText, tr } from '@/web/text/tr'

const MAX_KNOWN_TICKERS = 500
const SEARCH_LIMIT = 5

interface TickerNotice {
  readonly text: string
  /** The view the click came from: the line shows there and nowhere else. */
  readonly origin: PanelView
}

const notice = signal<TickerNotice | undefined>(undefined)
let search: AbortController | undefined

/** Why a click on a ticker opened nothing. */
export const tickerNotice: ReadonlySignal<TickerNotice | undefined> = notice

/** The tickers the page can name as links: held, watched, or named by a run in flight. */
export const knownTickers: ReadonlySignal<ReadonlySet<string>> = computed(() => {
  const names = [
    ...heldPositions.value.map((position) => position.instrument.ticker),
    ...watchedNames.value.map((instrument) => instrument.ticker),
    ...runs.value.flatMap((run) => run.tickers),
  ]

  return new Set([...new Set(names)].slice(0, MAX_KNOWN_TICKERS))
})

/** Opens the card of `ticker`; a name seen only in prose finds its market first. A search that
 *  fails or finds nothing leaves a line on the view the click came from, and its answer is dropped
 *  when the operator has gone elsewhere or clicked another name. */
export function openTicker(ticker: string, market?: string): void {
  search?.abort()
  search = undefined
  notice.value = undefined

  const known = market ?? marketOfKnown(ticker)

  if (known !== undefined) {
    openView({ ticker, market: known })
    return
  }

  const controller = new AbortController()
  const origin = panelView.value

  search = controller
  searchMarket(ticker, controller.signal).then(
    (found) => {
      if (isStale(controller, origin)) {
        return
      }

      if (found === undefined) {
        showNotice(tr('ui.office.ticker.notFound', { ticker }), origin)
        return
      }

      openView({ ticker, market: found })
    },
    (error: unknown) => {
      if (!isStale(controller, origin)) {
        showNotice(toErrorText(error), origin)
      }
    }
  )
}

// The line is on the view the click came from; a folded panel opens so it can be read.
function showNotice(text: string, origin: PanelView): void {
  notice.value = { text, origin }
  collapsed.value = false
}

/** Drops the line, once the operator has moved on. */
export function clearTickerNotice(): void {
  notice.value = undefined
}

function isStale(controller: AbortController, origin: PanelView): boolean {
  return controller.signal.aborted || panelView.value !== origin
}

function marketOfKnown(ticker: string): string | undefined {
  const held = heldPositions.value.find((position) => position.instrument.ticker === ticker)
  const watched = watchedNames.value.find((instrument) => instrument.ticker === ticker)

  return (held?.instrument ?? watched ?? findQuote(ticker))?.market
}

async function searchMarket(ticker: string, abort: AbortSignal): Promise<string | undefined> {
  const answer = await getJson(ROUTES.instruments, {
    query: { q: ticker, limit: SEARCH_LIMIT },
    signal: abort,
  })

  return answer.matches.find((match) => match.instrument.ticker === ticker)?.instrument.market
}
