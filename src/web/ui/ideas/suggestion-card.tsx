import { useSignal } from '@preact/signals'

import type { SuggestionCardWire, SuggestionWire } from '@/app/server/wire/trading'
import { formatDay } from '@/i18n'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { isAdvanced } from '@/web/state/prefs'
import { locale } from '@/web/state/session'
import { citationsOf } from '@/web/text/card-sources'
import { joinInline } from '@/web/text/glyphs'
import { toFailureText, tr } from '@/web/text/tr'
import { DebateFolds } from '@/web/ui/ideas/debate-folds'
import { Button } from '@/web/ui/kit/button'
import { Fold } from '@/web/ui/kit/fold'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { useLoad } from '@/web/ui/kit/use-load'
import { Markdown } from '@/web/ui/markdown/markdown'
import { TickerLink } from '@/web/ui/ticker/ticker-link'
import { openWhy } from '@/web/ui/ticker/why-dialog'

interface SuggestionCardProps {
  readonly call: SuggestionWire
  /** The operator has not looked at this call yet. */
  readonly isFresh: boolean
}

/** One standing plan: the name, what it says and when; opened, the decision card as the daemon
 *  words it, with the debate behind it in folds. Nothing here is computed on the page. */
export function SuggestionCard({ call, isFresh }: SuggestionCardProps) {
  const isOpen = useSignal(false)

  return (
    <article class="idea">
      <div class="idea-head">
        <b>
          <TickerLink ticker={call.instrument.ticker} market={call.instrument.market} />
        </b>
        {isFresh && <span class="idea-fresh">{tr('ui.office.ideas.fresh')}</span>}
        <button
          type="button"
          class="idea-toggle"
          aria-expanded={isOpen.value}
          onClick={() => {
            isOpen.value = !isOpen.value
          }}
        >
          <span>
            <span class={`idea-action is-${call.action}`}>
              {tr(`trading.action.${call.action}`)}
            </span>
            <span class="idea-conviction">
              {joinInline(['', tr(`trading.conviction.${call.conviction}`)])}
            </span>
          </span>
          <span class="meta">{formatDay(locale.value, call.at)}</span>
        </button>
      </div>
      {isOpen.value && <CardBody call={call} />}
    </article>
  )
}

function CardBody({ call }: { readonly call: SuggestionWire }) {
  const loaded = useLoad((abort) => getJson(ROUTES.suggestionCard(call.id), { signal: abort }))
  const result = loaded.value

  if (result.status === 'loading') {
    return <Skeleton />
  }

  if (result.status === 'failed') {
    return <p class="failure-line">{toFailureText(result.failure)}</p>
  }

  const { card } = result.value

  return card === null ? (
    <p class="meta">{tr('ui.office.today.empty')}</p>
  ) : (
    <CardText call={call} card={card} />
  )
}

function CardText({
  call,
  card,
}: {
  readonly call: SuggestionWire
  readonly card: SuggestionCardWire
}) {
  const citations = citationsOf(card)

  return (
    <div class="idea-body">
      <Markdown text={card.verdict} isLinked={false} />
      {call.thesis !== undefined && <p>{call.thesis}</p>}
      <Lines lines={card.reasons} />
      <Lines lines={card.levels} />
      <DebateFolds call={call} />
      {isAdvanced.value && citations.length > 0 && (
        <Fold
          title={tr(
            citations.length === 1
              ? 'ui.office.common.sourcesReadOne'
              : 'ui.office.common.sourcesRead',
            { count: citations.length }
          )}
        >
          <Markdown text={citations.map((line) => `- ${line}`).join('\n')} isLinked={false} />
        </Fold>
      )}
      <p class="meta">{card.disclaimer}</p>
      <Button size="small" onClick={() => openWhy({ kind: 'plan', call })}>
        {tr('ui.office.ticker.why')}
      </Button>
    </div>
  )
}

function Lines({ lines }: { readonly lines: readonly string[] }) {
  return lines.length === 0 ? null : (
    <Markdown text={lines.map((line) => `- ${line}`).join('\n')} isLinked={false} />
  )
}
