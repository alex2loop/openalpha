import { useSignal } from '@preact/signals'

import { openBook } from '@/web/state/book'
import { FORCE_ARG, runCommand, SUGGEST_COMMAND } from '@/web/state/command'
import { keyOf, watchedNames } from '@/web/state/market'
import { addWatch, qualifyName } from '@/web/state/watch'
import { toErrorText, tr } from '@/web/text/tr'
import { openAlertDialog } from '@/web/ui/dialogs/alert-dialog'
import { openTradeDialog } from '@/web/ui/dialogs/trade-dialog'
import { Button } from '@/web/ui/kit/button'

interface CardActionsProps {
  readonly ticker: string
  readonly market: string
  /** A stored call stands: a plain `/suggest` would hand it back, so a fresh run is offered too. */
  readonly hasPlan: boolean
}

/** What the operator can do with this name. "Phân tích mã này" runs at once, handing back a call
 *  already stored; "Phân tích lại từ đầu", offered only then, forces a fresh one. "Theo dõi" is free
 *  and changes the list at once; the alert and the trade open their forms. */
export function CardActions({ ticker, market, hasPlan }: CardActionsProps) {
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
      {hasPlan && (
        <Button onClick={() => runCommand(`${SUGGEST_COMMAND} ${ticker} ${FORCE_ARG}`)}>
          {tr('ui.office.common.suggestFresh')}
        </Button>
      )}
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

function FormButtons({ ticker, market }: Pick<CardActionsProps, 'ticker' | 'market'>) {
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
