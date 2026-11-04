import { useSignal } from '@preact/signals'

import type { MarketWire } from '@/app/server/wire/market'
import { marketsBlock, overviewBlock } from '@/web/state/market'
import { marketRegion } from '@/web/state/market-tab'
import {
  isRefreshing,
  refreshableMarkets,
  refreshMarkets,
  useRereadAfterRefresh,
} from '@/web/state/refresh'
import { tr } from '@/web/text/tr'
import { Button, type ButtonSize } from '@/web/ui/kit/button'

interface RefreshMarketsButtonProps {
  readonly markets: readonly MarketWire[]
  readonly size?: ButtonSize
}

/** "Cập nhật dữ liệu" for the markets of the region in view; the blocks read again when the run
 *  ends. */
export function RefreshButton() {
  const region = marketRegion.value

  useRereadAfterRefresh(() => {
    marketsBlock.retry()
    overviewBlock.retry()
  })

  if (region === undefined) {
    return null
  }

  return (
    <div class="market-refresh">
      <RefreshMarketsButton markets={refreshableMarkets(region)} />
    </div>
  )
}

/** Sends `/refresh` quiet for each of `markets`, never `force`, and waits while any refresh runs.
 *  The caller reads its own blocks again through `useRereadAfterRefresh`. */
export function RefreshMarketsButton({ markets, size }: RefreshMarketsButtonProps) {
  const failure = useSignal<string | undefined>(undefined)

  return (
    <>
      <Button
        {...(size === undefined ? {} : { size })}
        disabled={isRefreshing.value || markets.length === 0}
        onClick={() => {
          failure.value = undefined

          if (
            !refreshMarkets(markets, (message) => {
              failure.value = message
            })
          ) {
            failure.value = tr('ui.office.command.offline')
          }
        }}
      >
        {isRefreshing.value && <span class="spin" aria-hidden="true" />}
        {isRefreshing.value
          ? tr('ui.office.market.refreshing')
          : tr('ui.office.market.refreshData')}
      </Button>
      {failure.value !== undefined && (
        <p class="failure-line" role="alert">
          {failure.value}
        </p>
      )}
    </>
  )
}
