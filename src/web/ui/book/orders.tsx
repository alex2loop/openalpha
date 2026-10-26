import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import { useBlockRead } from '@/web/state/block'
import { onWireEvent } from '@/web/state/events'
import { readTrade, setBuyingHalted } from '@/web/state/orders'
import { toErrorText, tr } from '@/web/text/tr'
import { FailureStrip } from '@/web/ui/book/failure-strip'
import { OrderAnswer } from '@/web/ui/book/orders-answer'
import { OrderExits } from '@/web/ui/book/orders-exits'
import { StagedCard } from '@/web/ui/book/orders-staged'
import { Skeleton } from '@/web/ui/kit/skeleton'

// The command whose runs stage, place and cancel orders.
const TRADE_COMMAND = 'trade'
const COMMAND_RUN = 'command'

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
      <BuyingSwitch isHalted={data.haltedAt !== undefined} reread={reading.retry} />
      {error !== undefined && <FailureStrip failure={error} retry={reading.retry} />}
      <OrderAnswer />
      <h2 class="block-head">{tr('ui.office.orders.waiting')}</h2>
      {data.staged.length === 0 && <p class="meta">{tr('ui.office.orders.none')}</p>}
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
    const tradeRuns = new Set<string>()
    const offs = [
      onWireEvent('order_filled', reread),
      onWireEvent('run_started', (event) => {
        const { run, runId } = event

        if (runId !== undefined && run?.kind === COMMAND_RUN && run.name === TRADE_COMMAND) {
          tradeRuns.add(runId)
        }
      }),
      onWireEvent('run_finished', (event) => {
        if (event.runId !== undefined && tradeRuns.delete(event.runId)) {
          reread()
        }
      }),
    ]

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
