import type { RebalanceResponse, RebalanceTextWire } from '@/app/server/wire/money'
import type { TradingProfileResponse } from '@/app/server/wire/trading'
import { ROUTES } from '@/web/api/routes'
import { type BlockReading, readBlock, useBlock } from '@/web/state/block'
import { editionKey } from '@/web/state/edition'
import { heldPositions, holdingsBlock, profileBlock } from '@/web/state/market'
import { tr } from '@/web/text/tr'
import { EmptyBookActions, emptyBookKey } from '@/web/ui/book/empty-actions'
import { SegmentBars } from '@/web/ui/book/segment-bars'
import { openTargetsDialog } from '@/web/ui/dialogs/targets-dialog'
import { Button } from '@/web/ui/kit/button'
import { BulbIcon, PieIcon } from '@/web/ui/kit/icons'
import { ReportNotes } from '@/web/ui/markdown/report-notes'
import { BlockFrame } from '@/web/ui/today/block-frame'

// The plan moves with the book and the market read, not by the minute.
const REBALANCE_REFRESH_MS = 300_000

/** Cân bằng lại: the segments against the levels the user set, then the gaps or steps the daemon
 *  words. An empty book has neither: there is nothing to be off a level, so it says how to start. */
export function Rebalance() {
  return heldPositions.value.length === 0 ? <EmptyBook /> : <HeldBook />
}

function EmptyBook() {
  return (
    <BlockFrame
      title={tr('ui.office.book.actualVsTarget')}
      colour="green"
      icon={<PieIcon />}
      reading={readBlock(holdingsBlock)}
      dataTo={holdingsBlock.view.value.data?.asOf}
    >
      {() => (
        <>
          <p class="empty-note">{tr(emptyBookKey())}</p>
          <EmptyBookActions />
        </>
      )}
    </BlockFrame>
  )
}

function HeldBook() {
  const plan = useBlock(ROUTES.rebalance, { everyMs: REBALANCE_REFRESH_MS })
  const profile = profileBlock.view.value.data

  return (
    <>
      <BlockFrame
        title={tr('ui.office.book.actualVsTarget')}
        colour="green"
        icon={<PieIcon />}
        reading={readBlock(holdingsBlock)}
        dataTo={holdingsBlock.view.value.data?.asOf}
        action={profile === undefined ? undefined : <EditLevels profile={profile} plan={plan} />}
      >
        {(book) => (
          <>
            <SegmentBars shares={book.shares} />
            <p class="meta">{tr('ui.office.book.targetTick')}</p>
            <Ceilings lines={plan.data?.text.limits ?? []} />
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

interface EditLevelsProps {
  readonly profile: TradingProfileResponse
  readonly plan: BlockReading<RebalanceResponse>
}

// The targets dialog is the one place the levels are set; once saved, the bars and the gaps read
// the new levels at once.
function EditLevels({ profile, plan }: EditLevelsProps) {
  return (
    <Button
      size="small"
      onClick={() =>
        openTargetsDialog(profile, {
          onSaved: () => {
            holdingsBlock.retry()
            plan.retry()
          },
        })
      }
    >
      {tr('ui.office.book.editLevels')}
    </Button>
  )
}

// Where the book stands over a ceiling the user set, in the daemon's own words.
function Ceilings({ lines }: { readonly lines: readonly string[] }) {
  if (lines.length === 0) {
    return null
  }

  return (
    <>
      <h3 class="sub-head">{tr('ui.office.book.limitsHead')}</h3>
      <div class="stack">
        {lines.map((line) => (
          <p key={line} class="steps-line">
            {line}
          </p>
        ))}
      </div>
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
      <p class="meta">
        {tr(editionKey('ui.office.book.rebalanceNote', 'ui.office.edition.rebalance.note'))}
      </p>
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
