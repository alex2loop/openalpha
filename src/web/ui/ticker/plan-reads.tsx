import type { SuggestionCardWire } from '@/app/server/wire/trading'
import { tr } from '@/web/text/tr'
import { Fold } from '@/web/ui/kit/fold'
import { InlineMarkdown, Markdown } from '@/web/ui/markdown/markdown'

import './plan-reads.css'

// `/suggest` indents a level by two spaces; a quoted line is the evidence under a reading.
const INDENT_WIDTH = 2
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
    <div class="factor-lines">
      {lines.map((line, index) => {
        const text = line.trimStart()
        const isQuote = text.startsWith(QUOTE_PREFIX)

        return (
          <p
            key={index}
            class={isQuote ? 'factor-line meta' : 'factor-line'}
            style={{ '--depth': (indentOf(line) - base) / INDENT_WIDTH }}
          >
            <InlineMarkdown text={isQuote ? text.slice(QUOTE_PREFIX.length) : text} />
          </p>
        )
      })}
    </div>
  )
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}
