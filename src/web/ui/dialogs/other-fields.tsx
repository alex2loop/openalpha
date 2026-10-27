import { heldPositions } from '@/web/state/market'
import { formatQuantity } from '@/web/text/figures'
import { tr } from '@/web/text/tr'
import {
  DayField,
  Field,
  messageFor,
  TextField,
  TickerField,
  touch,
  VenueField,
} from '@/web/ui/dialogs/trade-fields'
import { marketCurrency, shapeOf } from '@/web/ui/dialogs/trade-kinds'
import {
  buildTradeDraft,
  marketOf,
  offerCurrencies,
  type TradeForm,
} from '@/web/ui/dialogs/trade-state'

/** The fields of every kind under Khác except a rights purchase, which lays out as a buy. */
export function OtherFields({ form }: { readonly form: TradeForm }) {
  switch (shapeOf(form.kind.value)) {
    case 'dividend':
      return <DividendFields form={form} />
    case 'shares':
      return <SharesFields form={form} />
    case 'transfer':
      return <TransferFields form={form} />
    case 'cash':
      return <CashFields form={form} />
    default:
      return null
  }
}

// The daemon books a dividend in its market's currency and refuses a stated one, so the unit only
// shows.
function DividendFields({ form }: { readonly form: TradeForm }) {
  const market = marketOf(form)
  const unit = market === undefined ? undefined : marketCurrency(market)

  return (
    <>
      <TickerField form={form} />
      <div class="form-row">
        <HoldingVenue form={form} />
        <DayField form={form} />
        <TextField
          form={form}
          id="trade-amount"
          label={tr('ui.office.trade.amountReceived')}
          value={form.amount}
          paths={['amount']}
          {...(unit === undefined ? {} : { hint: unit })}
        />
      </div>
    </>
  )
}

function SharesFields({ form }: { readonly form: TradeForm }) {
  const isDistribution = form.kind.value === 'distribution'
  const after = describeAfter(form)

  return (
    <>
      <TickerField form={form} />
      <div class="form-row">
        <HoldingVenue form={form} />
        <DayField form={form} />
        <TextField
          form={form}
          id="trade-quantity"
          label={tr(isDistribution ? 'ui.office.trade.received' : 'ui.office.trade.sharesDelta')}
          value={form.quantity}
          paths={['quantityDelta']}
          {...(isDistribution ? { hint: tr('ui.office.trade.receivedNote') } : {})}
        />
      </div>
      {after !== undefined && <p class="meta">{after}</p>}
    </>
  )
}

/** "Sau khi ghi: FPT 1.100 cổ phiếu" for a share change on a holding; absent with no holding. An
 *  edit takes the row's own change out of the holding first. */
function describeAfter(form: TradeForm): string | undefined {
  const build = buildTradeDraft(form)

  if (build.kind === 'invalid' || !('quantityDelta' in build.draft)) {
    return undefined
  }

  const { instrument, quantityDelta } = build.draft
  const held = heldPositions.value.find(
    (position) =>
      position.instrument.market === instrument.market &&
      position.instrument.ticker === instrument.ticker
  )
  const { entry } = form.start
  const own = entry !== undefined && 'quantityDelta' in entry ? entry.quantityDelta : 0

  return held === undefined
    ? undefined
    : tr('ui.office.trade.after', {
        ticker: instrument.ticker,
        quantity: formatQuantity(held.quantity - own + quantityDelta),
      })
}

function TransferFields({ form }: { readonly form: TradeForm }) {
  return (
    <>
      <div class="form-row">
        <VenueField
          form={form}
          id="trade-from-venue"
          label={tr('ui.office.trade.fromVenue')}
          value={form.fromVenue}
          path="fromVenue"
        />
        <VenueField
          form={form}
          id="trade-venue"
          label={tr('ui.office.trade.toVenue')}
          value={form.venue}
          path="venue"
        />
      </div>
      <div class="form-row">
        <CurrencyField form={form} />
        <AmountField form={form} />
        <TextField
          form={form}
          id="trade-fee"
          label={tr('ui.office.trade.fee')}
          value={form.fee}
          paths={['fee']}
        />
        <DayField form={form} />
      </div>
      <p class="meta">{tr('ui.office.trade.transferNote')}</p>
    </>
  )
}

function CashFields({ form }: { readonly form: TradeForm }) {
  return (
    <>
      <div class="form-row">
        <HoldingVenue form={form} />
        <CurrencyField form={form} />
      </div>
      <div class="form-row">
        <AmountField form={form} />
        <DayField form={form} />
      </div>
      <NoteField form={form} />
    </>
  )
}

function NoteField({ form }: { readonly form: TradeForm }) {
  return (
    <Field
      id="trade-note"
      label={tr('trading.render.ledger.label.note')}
      message={messageFor(form, 'note')}
      isWide
    >
      <input
        id="trade-note"
        type="text"
        value={form.note.value}
        onInput={(event) => {
          form.note.value = event.currentTarget.value
          touch(form)
        }}
      />
    </Field>
  )
}

function HoldingVenue({ form }: { readonly form: TradeForm }) {
  return (
    <VenueField
      form={form}
      id="trade-venue"
      label={tr('ui.office.trade.venue')}
      value={form.venue}
      path="venue"
    />
  )
}

function AmountField({ form }: { readonly form: TradeForm }) {
  return (
    <TextField
      form={form}
      id="trade-amount"
      label={tr('ui.office.trade.amount')}
      value={form.amount}
      paths={['amount']}
    />
  )
}

function CurrencyField({ form }: { readonly form: TradeForm }) {
  return (
    <Field
      id="trade-currency"
      label={tr('ui.office.trade.currency')}
      message={messageFor(form, 'currency')}
    >
      <select
        id="trade-currency"
        value={form.currency.value}
        onChange={(event) => {
          form.currency.value = event.currentTarget.value
          touch(form)
        }}
      >
        {offerCurrencies(form).map((currency) => (
          <option key={currency} value={currency}>
            {currency}
          </option>
        ))}
      </select>
    </Field>
  )
}
