import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import { useBlockRead } from '@/web/state/block'
import { onCommandFinished, onWireEvent } from '@/web/state/events'
import { readTrade, setBuyingHalted } from '@/web/state/orders'
import { toErrorText, tr } from '@/web/text/tr'
import { OrderAnswer } from '@/web/ui/book/orders-answer'
import { OrderExits } from '@/web/ui/book/orders-exits'
import { StagedCard } from '@/web/ui/book/orders-staged'
import { FailureStrip } from '@/web/ui/kit/failure-strip'
import { ListIcon } from '@/web/ui/kit/icons'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { BlockHead } from '@/web/ui/today/block-frame'

// The command whose runs stage, place and cancel orders.
const TRADE_COMMAND = 'trade'

/** Lệnh: orders staged in chat waiting for the operator, exits resting at the exchange, and fills
 *  the ledger lacks. It acts only through confirm, discard, exit cancel and the buy switch. */
export function Orders() {
  const reading = useBlockRead(readTrade, { capability: 'orders' })
  const { data, error } = reading

  useTradeRereads(reading.retry)

  if (data === undefined) {
    return error === undefined ? (
      <Skeleton />
    ) : (
      <FailureStrip failure={error} retry={reading.retry} />
    )
  }

  return (
    <section class="block">
      <BlockHead title={tr('ui.office.orders.waiting')} colour="blue" icon={<ListIcon />} />
      <BuyingSwitch isHalted={data.haltedAt !== undefined} reread={reading.retry} />
      {error !== undefined && <FailureStrip failure={error} retry={reading.retry} />}
      <OrderAnswer />
      {data.staged.length === 0 && <p class="empty-note">{tr('ui.office.orders.none')}</p>}
      {data.staged.map((order) => (
        <StagedCard key={order.token} order={order} reread={reading.retry} />
      ))}
      <OrderExits status={data} reread={reading.retry} />
    </section>
  )
}

// No timer: a fill, or a `/trade` run ending, is when the list changes.
function useTradeRereads(reread: () => void): void {
  useEffect(() => {
    const offs = [onWireEvent('order_filled', reread), onCommandFinished(TRADE_COMMAND, reread)]

    return () => {
      for (const off of offs) {
        off()
      }
    }
  }, [])
}

/** Off stops new buys only; sells, exits and cancels still go out. */
function BuyingSwitch({
  isHalted,
  reread,
}: {
  readonly isHalted: boolean
  readonly reread: () => void
}) {
  const isBusy = useSignal(false)
  const failure = useSignal<string | undefined>(undefined)

  function toggle(allow: boolean): void {
    isBusy.value = true
    failure.value = undefined
    setBuyingHalted(!allow)
      .then(reread)
      .catch((error: unknown) => {
        failure.value = toErrorText(error)
      })
      .finally(() => {
        isBusy.value = false
      })
  }

  return (
    <>
      <label class="form-check">
        <input
          type="checkbox"
          checked={!isHalted}
          disabled={isBusy.value}
          onChange={(event) => toggle(event.currentTarget.checked)}
        />
        <span>{tr('ui.office.orders.allowBuying')}</span>
      </label>
      {isHalted && <p class="strip is-caution">{tr('ui.office.orders.halted')}</p>}
      {failure.value !== undefined && (
        <p class="failure-line" role="alert">
          {failure.value}
        </p>
      )}
    </>
  )
}
