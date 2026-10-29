import type { SuggestionCardWire } from '@/app/server/wire/trading'
import { tr } from '@/web/text/tr'
import { Fold } from '@/web/ui/kit/fold'
import { Markdown } from '@/web/ui/markdown/markdown'

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
          <Lines lines={card.factors} />
        </Fold>
      )}
    </>
  )
}

function Lines({ lines }: { readonly lines: readonly string[] }) {
  return <Markdown text={lines.map((line) => `- ${line}`).join('\n')} isLinked={false} />
}
