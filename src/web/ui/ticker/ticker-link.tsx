import { openTicker } from '@/web/state/known-tickers'
import { findQuote } from '@/web/state/market'
import { formatSignedPercent } from '@/web/text/figures'
import { formatMarketPrice } from '@/web/text/market-price'

import './ticker.css'

interface TickerLinkProps {
  readonly ticker: string
  readonly market?: string
  /** Set inside a sentence: the link keeps the sentence's weight and shows a dotted underline. */
  readonly isInline?: true
  /** Set inside a moving strip: the copy that screen readers skip must not take focus. */
  readonly isHidden?: true | undefined
}

/** A ticker name that opens its card. The hover title is its price and day move off the board. */
export function TickerLink({ ticker, market, isInline, isHidden }: TickerLinkProps) {
  return (
    <button
      type="button"
      class={isInline === true ? 'ticker-link is-inline' : 'ticker-link'}
      title={describeTicker(ticker, market)}
      tabIndex={isHidden === true ? -1 : undefined}
      onClick={() => openTicker(ticker, market)}
    >
      {ticker}
    </button>
  )
}

function describeTicker(ticker: string, market: string | undefined): string | undefined {
  const quote = findQuote(ticker, market)

  if (quote === undefined) {
    return undefined
  }

  return [
    ticker,
    formatMarketPrice(quote.market, quote.last, quote.kind),
    formatSignedPercent(quote.changePct),
  ].join(' ')
}
