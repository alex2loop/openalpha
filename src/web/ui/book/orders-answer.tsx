import type {
  CapRejectionWire,
  ConfirmOrderResponse,
  StagedOrderWire,
} from '@/app/server/wire/orders'
import { clearPlaceAnswer, type PlaceAnswer, placeAnswer } from '@/web/state/orders'
import { formatQuantity } from '@/web/text/figures'
import { formatMarketPrice } from '@/web/text/market-price'
import { toFailureText, tr } from '@/web/text/tr'
import { toVenueName } from '@/web/text/venue'
import { Button } from '@/web/ui/kit/button'

type Executed = Extract<ConfirmOrderResponse, { readonly kind: 'executed' }>

/** What the last Đặt lệnh came back with, kept until the next one or until closed. */
export function OrderAnswer() {
  const answer = placeAnswer.value

  if (answer === undefined) {
    return null
  }

  return (
    <div class="strip is-grey" role="status">
      <AnswerLines answer={answer} />
      <div class="step-actions">
        <Button size="small" onClick={clearPlaceAnswer}>
          {tr('ui.office.common.close')}
        </Button>
      </div>
    </div>
  )
}

function AnswerLines({ answer }: { readonly answer: PlaceAnswer }) {
  switch (answer.kind) {
    case 'uncertain':
      return <p class="strip is-caution">{tr('ui.office.orders.uncertain')}</p>
    case 'refused':
      return <p class="failure-line">{toFailureText(answer.failure)}</p>
    case 'answered':
      return <ConfirmLines response={answer.response} />
  }
}

function ConfirmLines({ response }: { readonly response: ConfirmOrderResponse }) {
  switch (response.kind) {
    case 'unknown-token':
      return <p>{tr('ui.office.orders.unknownToken')}</p>
    case 'rejected':
      return (
        <>
          {response.rejections.map((rejection) => (
            <p key={rejection.code}>{rejectionText(response.order, rejection)}</p>
          ))}
        </>
      )
    case 'executed':
      return <ExecutedLines executed={response} />
  }
}

function ExecutedLines({ executed }: { readonly executed: Executed }) {
  const { exitFailure } = executed

  return (
    <>
      <p>{fillText(executed)}</p>
      {executed.exitPlaced && <p>{tr('ui.office.orders.exitPlaced')}</p>}
      {exitFailure !== undefined && (
        <p class="strip is-caution">
          {tr('ui.office.orders.exitFailed')} {exitFailure.text}
        </p>
      )}
    </>
  )
}

function fillText({ fill, order }: Executed): string {
  switch (fill.state) {
    case 'filled':
    case 'partially_filled':
      return tr('ui.office.orders.placed', {
        quantity: formatQuantity(fill.filledQuantity),
        price: formatMarketPrice(order.instrument.market, fill.averagePrice),
        venue: toVenueName(order.venue),
      })
    case 'live':
      return tr('ui.office.orders.resting')
    case 'canceled':
    case 'mmp_canceled':
      return tr('ui.office.orders.canceledAtVenue')
  }
}

// An open-trades cap counts positions; every other cap measures money in the order's market.
function rejectionText(order: StagedOrderWire, rejection: CapRejectionWire): string {
  const figure = (value: number): string =>
    rejection.code === 'openTrades'
      ? formatQuantity(value)
      : formatMarketPrice(order.instrument.market, value)

  return tr(`ui.office.orders.rejected.${rejection.code}`, {
    limit: figure(rejection.limit),
    actual: figure(rejection.actual),
    venue: toVenueName(rejection.venue ?? order.venue),
  })
}
