import { readBlock } from '@/web/state/block'
import { alertsBlock, keyOf } from '@/web/state/market'
import { tr } from '@/web/text/tr'
import { AlertRow } from '@/web/ui/book/alert-row'
import { BellIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'

/** "Cảnh báo giá" on this name; absent while it has none. */
export function CardAlerts({
  ticker,
  market,
}: {
  readonly ticker: string
  readonly market: string
}) {
  const key = keyOf({ market, ticker })
  const reading = readBlock(alertsBlock)
  const mine = (reading.data?.alerts ?? []).filter(
    (alert) =>
      keyOf(alert.instrument) === key && alert.source === 'you' && alert.state !== 'disabled'
  )

  if (reading.data !== undefined && mine.length === 0) {
    return null
  }

  return (
    <BlockFrame
      title={tr('ui.office.common.priceAlerts')}
      colour="pink"
      icon={<BellIcon />}
      reading={reading}
    >
      {() => (
        <div class="row-list">
          {mine.map((alert) => (
            <AlertRow key={alert.id} alert={alert} withTicker={false} />
          ))}
        </div>
      )}
    </BlockFrame>
  )
}
