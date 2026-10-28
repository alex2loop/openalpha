import { useSignal } from '@preact/signals'

import { openBook } from '@/web/state/book'
import { runCommand, SUGGEST_COMMAND } from '@/web/state/command'
import { estimateText } from '@/web/state/estimates'
import { keyOf, watchedNames } from '@/web/state/market'
import { addWatch, qualifyName } from '@/web/state/watch'
import { toErrorText, tr } from '@/web/text/tr'
import { openAlertDialog } from '@/web/ui/dialogs/alert-dialog'
import { openTradeDialog } from '@/web/ui/dialogs/trade-dialog'
import { Button } from '@/web/ui/kit/button'

interface CardActionsProps {
  readonly ticker: string
  readonly market: string
}

/** What the operator can do with this name. "Phân tích mã này" runs at once, its AI cost shown beside
 *  it; "Theo dõi" is free and changes the list at once; the alert and the trade
 *  open their forms. */
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
      <Button kind="ai" onClick={() => runCommand(`${SUGGEST_COMMAND} ${ticker}`)}>
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
      <FormButtons ticker={ticker} market={market} />
      {failure.value !== undefined && <p class="failure-line">{failure.value}</p>}
    </div>
  )
}

function FormButtons({ ticker, market }: CardActionsProps) {
  return (
    <>
      <Button onClick={() => openAlertDialog({ ticker, market })}>
        {tr('ui.office.ticker.alertCta')}
      </Button>
      <Button onClick={() => openTradeDialog({ ticker, market })}>
        {tr('ui.office.common.recordTrade')}
      </Button>
    </>
  )
}
