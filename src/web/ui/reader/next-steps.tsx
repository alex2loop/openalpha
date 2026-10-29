import { knownTickers } from '@/web/state/known-tickers'
import { linkTickers } from '@/web/text/ticker-links'
import { tr } from '@/web/text/tr'
import { SuggestChip } from '@/web/ui/ticker/suggest-chip'

const NAMES_MAX = 6

interface NextStepsProps {
  /** Every word of the page. */
  readonly text: string
  /** Runs just before a chip sends its command. */
  readonly onRun: () => void
}

/** A "/suggest" chip for each name the report mentions that the page knows. */
export function NextSteps({ text, onRun }: NextStepsProps) {
  const names = linkTickers(text, knownTickers.value)
    .flatMap((part) => ('ticker' in part ? [part.ticker] : []))
    .slice(0, NAMES_MAX)

  if (names.length === 0) {
    return null
  }

  return (
    <section class="reader-next">
      <h3 class="md-heading">{tr('trading.brief.section.next-actions')}</h3>
      <div class="reader-chips">
        {names.map((name) => (
          <SuggestChip key={name} ticker={name} onRun={onRun} />
        ))}
      </div>
    </section>
  )
}
