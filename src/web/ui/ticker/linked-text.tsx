import { knownTickers } from '@/web/state/known-tickers'
import { linkTickers } from '@/web/text/ticker-links'
import { TickerLink } from '@/web/ui/ticker/ticker-link'

/** One paragraph of prose with the first mention of each known ticker made a link. */
export function LinkedText({ text }: { readonly text: string }) {
  const parts = linkTickers(text, knownTickers.value)

  return (
    <>
      {parts.map((part, index) =>
        'ticker' in part ? (
          <TickerLink key={`${index}:${part.ticker}`} ticker={part.ticker} isInline />
        ) : (
          part.text
        )
      )}
    </>
  )
}
