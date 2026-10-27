import { useSignal } from '@preact/signals'

import { estimateText } from '@/web/state/estimates'
import { marketsBlock, overviewBlock } from '@/web/state/market'
import { marketRegion } from '@/web/state/market-tab'
import {
  isRefreshing,
  REFRESH_COMMAND,
  refreshableMarkets,
  refreshMarkets,
  useRereadAfterRefresh,
} from '@/web/state/refresh'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'

/** "Cập nhật dữ liệu": `/refresh` for the markets of the region in view, with what it may cost
 *  beside it. It never forces; the blocks read again when the run ends. */
export function RefreshButton() {
  const region = marketRegion.value
  const isNotSent = useSignal(false)

  useRereadAfterRefresh(() => {
    marketsBlock.retry()
    overviewBlock.retry()
  })

  if (region === undefined) {
    return null
  }

  const markets = refreshableMarkets(region)
  // No estimate yet (too few runs to quote one) still says the macro reading can call the model.
  const note = estimateText(REFRESH_COMMAND) ?? tr('ui.office.market.refreshMayCallAi')

  return (
    <div class="market-refresh">
      <span class="meta">{note}</span>
      <Button
        disabled={isRefreshing.value || markets.length === 0}
        onClick={() => {
          isNotSent.value = !refreshMarkets(markets)
        }}
      >
        {isRefreshing.value
          ? tr('ui.office.market.refreshing')
          : tr('ui.office.market.refreshData')}
      </Button>
      {isNotSent.value && (
        <p class="failure-line" role="alert">
          {tr('ui.office.command.notSent')}
        </p>
      )}
    </div>
  )
}
