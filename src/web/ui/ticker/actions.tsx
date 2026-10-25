import { useSignal } from '@preact/signals'

import { openBook } from '@/web/state/book'
import { fillInput, SUGGEST_COMMAND } from '@/web/state/command'
import { estimateText } from '@/web/state/estimates'
import { keyOf, watchedNames } from '@/web/state/market'
import { addWatch, qualifyName } from '@/web/state/watch'
import { toErrorText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'

interface CardActionsProps {
  readonly ticker: string
  readonly market: string
}

/** What the operator can do with this name. "Đề xuất lại" only fills the box, so the AI cost is
 *  theirs to confirm; "Theo dõi" is free and changes the list at once. */
export function CardActions({ ticker, market }: CardActionsProps) {
  const failure = useSignal<string | undefined>(undefined)
  const isBusy = useSignal(false)
  const isWatched = watchedNames.value.some(
    (instrument) => keyOf(instrument) === keyOf({ market, ticker })
  )

  function watch(): void {
    isBusy.value = true
    failure.value = undefined
    addWatch(qualifyName({ market, ticker }))
      .then((refusal) => {
        failure.value = refusal
      })
      .catch((error: unknown) => {
        failure.value = toErrorText(error)
      })
      .finally(() => {
        isBusy.value = false
      })
  }

  return (
    <div class="card-actions">
      <Button kind="ai" onClick={() => fillInput(`${SUGGEST_COMMAND} ${ticker}`)}>
        {tr('ui.office.ticker.suggestCta')}
      </Button>
      <span class="meta">{estimateText(SUGGEST_COMMAND)}</span>
      {isWatched ? (
        <Button onClick={() => openBook('watch')}>{tr('ui.office.ticker.watching')}</Button>
      ) : (
        <Button disabled={isBusy.value} onClick={watch}>
          {tr('ui.office.ticker.watchCta')}
        </Button>
      )}
      {failure.value !== undefined && <p class="failure-line">{failure.value}</p>}
    </div>
  )
}
