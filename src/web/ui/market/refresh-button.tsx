import { useSignal } from '@preact/signals'

import { marketsBlock, overviewBlock } from '@/web/state/market'
import { marketRegion } from '@/web/state/market-tab'
import {
  isRefreshing,
  refreshableMarkets,
  refreshMarkets,
  useRereadAfterRefresh,
} from '@/web/state/refresh'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'

/** "Cập nhật dữ liệu": `/refresh` for the markets of the region in view. It never forces; the
 *  blocks read again when the run ends. */
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

  return (
    <div class="market-refresh">
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
