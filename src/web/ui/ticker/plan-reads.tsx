import type { SuggestionCardWire } from '@/app/server/wire/trading'
import { tr } from '@/web/text/tr'
import { Fold } from '@/web/ui/kit/fold'
import { DepthLines, indentOf, toDepthLine } from '@/web/ui/markdown/depth-lines'
import { Markdown } from '@/web/ui/markdown/markdown'

// A quoted line is the evidence under a reading.
const QUOTE_PREFIX = '> '

/** What the card says beside the levels: what the trader still waits for, and the factor checklist
 *  the score was read from, both in the words `/suggest` prints them in. */
export function PlanReads({ card }: { readonly card: SuggestionCardWire }) {
  return (
    <>
      {card.watch.length > 0 && (
        <section>
          <h3 class="sub-head">{tr('ui.office.ticker.watch')}</h3>
          <Lines lines={card.watch} />
        </section>
      )}
      {card.factors.length > 0 && (
        <Fold title={tr('ui.office.ticker.factors')}>
          <FactorLines lines={card.factors} />
        </Fold>
      )}
    </>
  )
}

function Lines({ lines }: { readonly lines: readonly string[] }) {
  return <Markdown text={lines.map((line) => `- ${line}`).join('\n')} isLinked={false} />
}

/** The checklist as `/suggest` lays it out: each line at its depth, the quoted evidence muted. */
function FactorLines({ lines }: { readonly lines: readonly string[] }) {
  const base = Math.min(...lines.map(indentOf))

  return (
    <DepthLines
      lines={lines.map((line) => {
        const placed = toDepthLine(line, base)
        const isQuote = placed.text.startsWith(QUOTE_PREFIX)

        return isQuote
          ? { ...placed, text: placed.text.slice(QUOTE_PREFIX.length), isMuted: true }
          : placed
      })}
    />
  )
}
