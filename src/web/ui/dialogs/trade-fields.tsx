import type { ComponentChildren } from 'preact'
import { useEffect } from 'preact/hooks'

import { translateDisplayText } from '@/i18n'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { locale } from '@/web/state/session'
import { boardScaleNotes } from '@/web/text/market-price'
import { tr } from '@/web/text/tr'
import { describeFailure, type FormFailure } from '@/web/ui/dialogs/field-errors'
import { FieldNote } from '@/web/ui/dialogs/field-note'
import { chooseVenue, marketOf, offerVenues, type TradeForm } from '@/web/ui/dialogs/trade-state'
import { Segmented } from '@/web/ui/kit/segmented'

export const PRICE_FIELD_ID = 'trade-price'
/** The paths of the draft this dialog has a field for. */
export const TRADE_PATHS = [
  'instrument.ticker',
  'instrument.market',
  'quantity',
  'unitPrice',
  'fee',
  'at',
  'venue',
]

interface FieldProps {
  readonly id: string
  readonly label: string
  readonly message: string | undefined
  readonly hint?: string
  readonly children: ComponentChildren
}

/** The fields of the form; the preview, notes and question sit around them in the dialog. */
export function TradeFields({ form }: { readonly form: TradeForm }) {
  useVenues(form)

  return (
    <>
      <Segmented
        label={tr('ui.office.common.recordTrade')}
        value={form.kind.value}
        options={(['buy', 'sell'] as const).map((value) => ({
          value,
          label: tr(`trading.ledger.kind.${value}`),
        }))}
        onChange={(value) => {
          form.kind.value = value
          touch(form)
        }}
      />
      <TickerField form={form} />
      <div class="form-row">
        <QuantityField form={form} />
        <PriceField form={form} />
      </div>
      <div class="form-row">
        <VenueField form={form} />
        <DayField form={form} />
        <FeeField form={form} />
      </div>
    </>
  )
}

function Field({ id, label, message, hint, children }: FieldProps) {
  return (
    <div class="form-field">
      <label class="form-label" for={id}>
        {label}
      </label>
      {children}
      {hint !== undefined && <span class="meta">{hint}</span>}
      <FieldNote message={message} />
    </div>
  )
}

function TickerField({ form }: { readonly form: TradeForm }) {
  return (
    <Field
      id="trade-ticker"
      label={tr('ui.office.common.ticker')}
      message={messageFor(form, 'instrument.ticker', 'instrument.market')}
    >
      <input
        id="trade-ticker"
        type="text"
        class="mono"
        value={form.ticker.value}
        readOnly={form.start.entry !== undefined}
        onInput={(event) => {
          form.ticker.value = event.currentTarget.value
          chooseVenue(form)
          touch(form)
        }}
      />
    </Field>
  )
}

function QuantityField({ form }: { readonly form: TradeForm }) {
  return (
    <Field
      id="trade-quantity"
      label={tr('ui.office.trade.quantity')}
      message={messageFor(form, 'quantity')}
    >
      <input
        id="trade-quantity"
        type="text"
        inputMode="decimal"
        class="form-number"
        value={form.quantity.value}
        onInput={(event) => {
          form.quantity.value = event.currentTarget.value
          touch(form)
        }}
      />
    </Field>
  )
}

function PriceField({ form }: { readonly form: TradeForm }) {
  const market = marketOf(form)
  const [scale] = market === undefined ? [] : boardScaleNotes([market])

  return (
    <Field
      id={PRICE_FIELD_ID}
      label={tr('ui.office.trade.price')}
      message={messageFor(form, 'unitPrice')}
      {...(scale === undefined ? {} : { hint: scale })}
    >
      <input
        id={PRICE_FIELD_ID}
        type="text"
        inputMode="decimal"
        class="form-number"
        value={form.price.value}
        onInput={(event) => {
          form.price.value = event.currentTarget.value
          touch(form)
        }}
      />
    </Field>
  )
}

function VenueField({ form }: { readonly form: TradeForm }) {
  return (
    <Field id="trade-venue" label={tr('ui.office.trade.venue')} message={messageFor(form, 'venue')}>
      <select
        id="trade-venue"
        value={form.venue.value}
        onChange={(event) => {
          form.venue.value = event.currentTarget.value
          touch(form)
        }}
      >
        {offerVenues(form).map((choice) => (
          <option key={choice.venue} value={choice.venue}>
            {venueName(choice.venue)}
          </option>
        ))}
      </select>
    </Field>
  )
}

function DayField({ form }: { readonly form: TradeForm }) {
  return (
    <Field id="trade-day" label={tr('ui.office.trade.day')} message={messageFor(form, 'at')}>
      <input
        id="trade-day"
        type="text"
        inputMode="numeric"
        class="form-number"
        value={form.day.value}
        onInput={(event) => {
          form.day.value = event.currentTarget.value
          touch(form)
        }}
      />
    </Field>
  )
}

function FeeField({ form }: { readonly form: TradeForm }) {
  return (
    <Field
      id="trade-fee"
      label={tr('ui.office.trade.fee')}
      message={messageFor(form, 'fee')}
      hint={tr('ui.office.trade.feeHint')}
    >
      <input
        id="trade-fee"
        type="text"
        inputMode="decimal"
        class="form-number"
        value={form.fee.value}
        onInput={(event) => {
          form.fee.value = event.currentTarget.value
          touch(form)
        }}
      />
    </Field>
  )
}

/** A venue by its catalog name; one the catalog does not know (a broker of the operator's own)
 *  prints as its id. */
function venueName(venue: string): string {
  return translateDisplayText(locale.value, { key: `trading.venue.${venue}`, fallback: venue })
}

/** Any edit drops the question and the refusals about the old figures. */
function touch(form: TradeForm): void {
  form.question.value = undefined
  form.refused.value = new Map()
  form.failure.value = undefined
}

function messageFor(form: TradeForm, ...paths: readonly string[]): string | undefined {
  const failure: FormFailure | undefined = form.failure.value

  for (const path of paths) {
    const message = form.refused.value.get(path) ?? failure?.fields.get(path)

    if (message !== undefined) {
      return message
    }
  }

  return undefined
}

// The venues are read once, when the dialog mounts; leaving it ends the read.
function useVenues(form: TradeForm): void {
  useEffect(() => {
    const controller = new AbortController()

    getJson(ROUTES.venues, { signal: controller.signal }).then(
      (answer) => {
        form.venues.value = answer.venues
        chooseVenue(form)
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          form.failure.value = describeFailure(error, TRADE_PATHS)
        }
      }
    )

    return () => controller.abort()
  }, [])
}
