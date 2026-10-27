import type { RebalanceResponse, RebalanceTextWire } from '@/app/server/wire/money'
import { ROUTES } from '@/web/api/routes'
import { readBlock, useBlock } from '@/web/state/block'
import { holdingsBlock } from '@/web/state/market'
import { tr } from '@/web/text/tr'
import { SegmentBars } from '@/web/ui/book/segment-bars'
import { BulbIcon, PieIcon } from '@/web/ui/kit/icons'
import { ReportNotes } from '@/web/ui/markdown/report-notes'
import { BlockFrame } from '@/web/ui/today/block-frame'

// The plan moves with the book and the market read, not by the minute.
const REBALANCE_REFRESH_MS = 300_000

/** Cân bằng lại: the segments against their targets, then the steps the daemon proposes. */
export function Rebalance() {
  const plan = useBlock(ROUTES.rebalance, { everyMs: REBALANCE_REFRESH_MS })

  return (
    <>
      <BlockFrame
        title={tr('ui.office.book.actualVsTarget')}
        colour="green"
        icon={<PieIcon />}
        reading={readBlock(holdingsBlock)}
        dataTo={holdingsBlock.view.value.data?.asOf}
      >
        {(book) => (
          <>
            <SegmentBars shares={book.shares} />
            <p class="meta">{tr('ui.office.book.targetTick')}</p>
          </>
        )}
      </BlockFrame>
      <BlockFrame
        title={tr('ui.office.book.rebalance')}
        colour="yellow"
        icon={<BulbIcon />}
        reading={plan}
      >
        {(answer) => <Steps plan={answer} />}
      </BlockFrame>
    </>
  )
}

function Steps({ plan }: { readonly plan: RebalanceResponse }) {
  const { text } = plan

  return (
    <>
      <div class="stack">
        {text.headline.map((line) => (
          <p key={line} class="steps-line">
            {line}
          </p>
        ))}
      </div>
      {plan.status === 'ready' && <Orders text={text} />}
      <ReportNotes lines={text.notes} />
      <p class="meta">{tr('ui.office.book.rebalanceNote')}</p>
    </>
  )
}

// Breaches first, then the rest, each group under the words the daemon gave it.
function Orders({ text }: { readonly text: RebalanceTextWire }) {
  return (
    <>
      <OrderGroup heading={text.groups.first} text={text} group="first" />
      <OrderGroup heading={text.groups.later} text={text} group="later" />
    </>
  )
}

interface OrderGroupProps {
  readonly heading: string
  readonly text: RebalanceTextWire
  readonly group: 'first' | 'later'
}

function OrderGroup({ heading, text, group }: OrderGroupProps) {
  const orders = text.orders.filter((order) => order.group === group)

  if (orders.length === 0) {
    return null
  }

  return (
    <>
      <h3 class="sub-head">{heading}</h3>
      <ol class="steps-list">
        {orders.map((order) => (
          <li key={`${order.instrument.market}:${order.instrument.ticker}`}>{order.line}</li>
        ))}
      </ol>
    </>
  )
}
