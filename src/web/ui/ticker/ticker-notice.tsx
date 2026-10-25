import { useEffect } from 'preact/hooks'

import { clearTickerNotice, tickerNotice } from '@/web/state/known-tickers'
import { panelView } from '@/web/state/panel'

/** The line a click on a ticker leaves when it opened nothing, on the view it came from; it goes
 *  when the view changes. */
export function TickerNotice() {
  const notice = tickerNotice.value
  const view = panelView.value
  const isElsewhere = notice !== undefined && notice.origin !== view

  useEffect(() => {
    if (isElsewhere) {
      clearTickerNotice()
    }
  }, [isElsewhere])

  if (notice === undefined || isElsewhere) {
    return null
  }

  return (
    <p class="strip is-problem" role="alert">
      {notice.text}
    </p>
  )
}
