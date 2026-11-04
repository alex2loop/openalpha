import { type Signal, useSignal } from '@preact/signals'

import { openBook } from '@/web/state/book'
import { keyOf, watchedNames } from '@/web/state/market'
import { addWatch, qualifyName } from '@/web/state/watch'
import { toErrorText, tr } from '@/web/text/tr'
import { Button, type ButtonSize } from '@/web/ui/kit/button'

interface WatchButtonProps {
  readonly ticker: string
  readonly market: string
  /** Where the daemon's refusal, or a failure to reach it, is put in words for the caller to show. */
  readonly failure: Signal<string | undefined>
  readonly size?: ButtonSize
}

/** "Theo dõi" for a name: free and changes the list at once. A name already on the list opens it. */
export function WatchButton({ ticker, market, failure, size }: WatchButtonProps) {
  const isBusy = useSignal(false)
  const isWatched = watchedNames.value.some(
    (instrument) => keyOf(instrument) === keyOf({ market, ticker })
  )
  const sizing = size === undefined ? {} : { size }

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

  if (isWatched) {
    return (
      <Button {...sizing} onClick={() => openBook('watch')}>
        {tr('ui.office.ticker.watching')}
      </Button>
    )
  }

  return (
    <Button {...sizing} disabled={isBusy.value} onClick={watch}>
      {tr('ui.office.ticker.watchCta')}
    </Button>
  )
}
