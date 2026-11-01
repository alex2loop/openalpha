import { useSignal } from '@preact/signals'

import type { StagedOrderWire } from '@/app/server/wire/orders'
import { holdingsBlock } from '@/web/state/market'
import { discardOrder, placeOrder, placingTokens } from '@/web/state/orders'
import { formatPrice, formatQuantity, WHOLE_DISPLAY } from '@/web/text/figures'
import { formatMarketPrice } from '@/web/text/market-price'
import { toErrorText, tr } from '@/web/text/tr'
import { toVenueName } from '@/web/text/venue'
import { Button } from '@/web/ui/kit/button'
import { askConfirm } from '@/web/ui/kit/confirm'

interface StagedProps {
  readonly order: StagedOrderWire
  /** Reads the tab again once an action answered. */
  readonly reread: () => void
}

/** One order staged in chat, composed from its fields. Placing asks once; from then until the
 *  daemon answers the button stays disabled, wherever the page goes meanwhile. */
export function StagedCard({ order, reread }: StagedProps) {
  const isDiscarding = useSignal(false)
  const failure = useSignal<string | undefined>(undefined)
  const venue = toVenueName(order.venue)
  const isPlacing = placingTokens.value.has(order.token)

  function discard(): void {
    isDiscarding.value = true
    failure.value = undefined
    discardOrder(order.token)
      .then(reread)
      .catch((error: unknown) => {
        failure.value = toErrorText(error)
      })
      .finally(() => {
        isDiscarding.value = false
      })
  }

  return (
    <div class="strip is-grey">
      <StagedFacts order={order} venue={venue} />
      <div class="step-actions">
        <Button
          kind="commit"
          size="small"
          disabled={isPlacing || isDiscarding.value}
          onClick={() => askPlace(order, reread)}
        >
          {tr('ui.office.orders.place', { venue })}
        </Button>
        <Button size="small" disabled={isPlacing || isDiscarding.value} onClick={discard}>
          {tr('ui.office.orders.discard')}
        </Button>
      </div>
      {failure.value !== undefined && (
        <p class="failure-line" role="alert">
          {failure.value}
        </p>
      )}
    </div>
  )
}

// The question closes as the confirm goes out: the answer lands on the tab, never in a dialog whose
// button could send it again.
function askPlace(order: StagedOrderWire, reread: () => void): void {
  const venue = toVenueName(order.venue)

  askConfirm({
    title: tr('ui.office.orders.placeAsk', { venue }),
    lines: [tr('ui.office.orders.placeBody')],
    confirmLabel: tr('ui.office.orders.place', { venue }),
    confirm: () => {
      placeOrder(order)
        .finally(reread)
        .catch(() => undefined)
    },
  })
}

function StagedFacts({
  order,
  venue,
}: {
  readonly order: StagedOrderWire
  readonly venue: string
}) {
  const { market, ticker } = order.instrument
  const price = (value: number | undefined): string => formatMarketPrice(market, value)
  const currency = holdingsBlock.view.value.data?.baseCurrency
  const notional = formatPrice(order.notionalBase, WHOLE_DISPLAY)
  const hasLevels = order.takeProfit !== undefined || order.stopLoss !== undefined

  return (
    <div>
      <p>
        {tr('ui.office.orders.staged', {
          side: tr(`ui.office.orders.side.${order.side}`),
          quantity: formatQuantity(order.quantity),
          ticker,
          type:
            order.orderType === 'limit'
              ? tr('ui.office.orders.limitType', { price: price(order.limitPrice) })
              : tr('ui.office.orders.marketType'),
          notional: currency === undefined ? notional : `${notional} ${currency}`,
        })}
      </p>
      {hasLevels && (
        <p class="meta">
          {tr('ui.office.orders.levels', {
            takeProfit: price(order.takeProfit),
            stopLoss: price(order.stopLoss),
          })}
        </p>
      )}
      <p class="meta">{tr('ui.office.orders.quote', { price: price(order.quotePrice), venue })}</p>
    </div>
  )
}
