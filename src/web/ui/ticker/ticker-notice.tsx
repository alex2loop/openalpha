import { tickerNotice } from '@/web/state/known-tickers'
import { panelView } from '@/web/state/panel'

/** The line a click on a ticker leaves when it opened nothing, on the view it came from. */
export function TickerNotice() {
  const notice = tickerNotice.value

  if (notice === undefined || notice.origin !== panelView.value) {
    return null
  }

  return (
    <p class="strip is-problem" role="alert">
      {notice.text}
    </p>
  )
}
