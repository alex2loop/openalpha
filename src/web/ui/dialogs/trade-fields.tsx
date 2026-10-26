import type { Signal } from '@preact/signals'
import type { ComponentChildren } from 'preact'
import { useEffect } from 'preact/hooks'

import type { LedgerKind } from '@/web/state/trade'
import { translateDisplayText } from '@/i18n'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { locale } from '@/web/state/session'
import { joinInline } from '@/web/text/glyphs'
import { boardScaleNotes } from '@/web/text/market-price'
import { tr } from '@/web/text/tr'
import { describeFailure, type FormFailure } from '@/web/ui/dialogs/field-errors'
import { FieldNote } from '@/web/ui/dialogs/field-note'
import { fieldPathsOf, OTHER_KINDS } from '@/web/ui/dialogs/trade-kinds'
import { chooseVenue, marketOf, offerVenues, type TradeForm } from '@/web/ui/dialogs/trade-state'
import { Segmented } from '@/web/ui/kit/segmented'

export const PRICE_FIELD_ID = 'trade-price'
const MAIN_KINDS: readonly LedgerKind[] = Object.freeze(['buy', 'sell'])
// The menu's first line, standing for "Khác" until a kind is picked.
const OTHER_VALUE = ''

interface FieldProps {
  readonly id: string
  readonly label: string
  readonly message: string | undefined
  readonly hint?: string
  readonly children: ComponentChildren
}

interface TextFieldProps {
  readonly form: TradeForm
  readonly id: string
  readonly label: string
  readonly value: Signal<string>
  /** The draft paths whose refusal shows under it. */
  readonly paths: readonly string[]
  readonly hint?: string
}

interface VenueFieldProps {
  readonly form: TradeForm
  readonly id: string
  readonly label: string
  readonly value: Signal<string>
  readonly path: string
}

/** Mua | Bán | Khác ▾: the menu names each other kind with what it is for. */
export function KindRow({ form }: { readonly form: TradeForm }) {
  const kind = form.kind.value
  const isOther = !MAIN_KINDS.includes(kind)

  return (
    <div class="form-row">
      <Segmented
        label={tr('ui.office.common.recordTrade')}
        value={kind}
        options={MAIN_KINDS.map((value) => ({ value, label: tr(`trading.ledger.kind.${value}`) }))}
        onChange={(value) => pickKind(form, value)}
      />
      <select
        aria-label={tr('ui.office.trade.other')}
        value={isOther ? kind : OTHER_VALUE}
        onChange={(event) => {
          const picked = OTHER_KINDS.find((other) => other.kind === event.currentTarget.value)

          if (picked !== undefined) {
            pickKind(form, picked.kind)
          }
        }}
      >
        <option value={OTHER_VALUE} disabled>
          {tr('ui.office.trade.other')}
        </option>
        {OTHER_KINDS.map((other) => (
          <option key={other.kind} value={other.kind}>
            {joinInline([tr(`trading.ledger.kind.${other.kind}`), tr(other.hint)])}
          </option>
        ))}
      </select>
    </div>
  )
}

function pickKind(form: TradeForm, kind: LedgerKind): void {
  form.kind.value = kind
  chooseVenue(form)
  touch(form)
}

/** A buy, a sell or a rights purchase. */
export function PricedFields({ form }: { readonly form: TradeForm }) {
  const isRights = form.kind.value === 'rights'

  return (
    <>
      <TickerField form={form} />
      <div class="form-row">
        <TextField
          form={form}
          id="trade-quantity"
          label={tr('ui.office.trade.quantity')}
          value={form.quantity}
          paths={['quantity']}
        />
        <PriceField form={form} />
      </div>
      <div class="form-row">
        <VenueField
          form={form}
          id="trade-venue"
          label={tr('ui.office.trade.venue')}
          value={form.venue}
          path="venue"
        />
        <DayField form={form} />
        <TextField
          form={form}
          id="trade-fee"
          label={tr('ui.office.trade.fee')}
          value={form.fee}
          paths={['fee']}
          {...(isRights ? {} : { hint: tr('ui.office.trade.feeHint') })}
        />
      </div>
    </>
  )
}

export function Field({ id, label, message, hint, children }: FieldProps) {
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

export function TickerField({ form }: { readonly form: TradeForm }) {
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
        readOnly={form.start.entry !== undefined && 'instrument' in form.start.entry}
        onInput={(event) => {
          form.ticker.value = event.currentTarget.value
          chooseVenue(form)
          touch(form)
        }}
      />
    </Field>
  )
}

/** A figure the operator types. */
export function TextField({ form, id, label, value, paths, hint }: TextFieldProps) {
  return (
    <Field
      id={id}
      label={label}
      message={messageFor(form, ...paths)}
      {...(hint === undefined ? {} : { hint })}
    >
      <input
        id={id}
        type="text"
        inputMode="decimal"
        class="form-number"
        value={value.value}
        onInput={(event) => {
          value.value = event.currentTarget.value
          touch(form)
        }}
      />
    </Field>
  )
}

function PriceField({ form }: { readonly form: TradeForm }) {
  const market = marketOf(form)
  const [scale] = market === undefined ? [] : boardScaleNotes([market])
  const label =
    form.kind.value === 'rights' ? 'ui.office.trade.rightsPrice' : 'ui.office.trade.price'

  return (
    <TextField
      form={form}
      id={PRICE_FIELD_ID}
      label={tr(label)}
      value={form.price}
      paths={['unitPrice']}
      {...(scale === undefined ? {} : { hint: scale })}
    />
  )
}

export function VenueField({ form, id, label, value, path }: VenueFieldProps) {
  return (
    <Field id={id} label={label} message={messageFor(form, path)}>
      <select
        id={id}
        value={value.value}
        onChange={(event) => {
          value.value = event.currentTarget.value
          chooseVenue(form)
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

export function DayField({ form }: { readonly form: TradeForm }) {
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

/** A venue by its catalog name; one the catalog does not know (a broker of the operator's own)
 *  prints as its id. */
function venueName(venue: string): string {
  return translateDisplayText(locale.value, { key: `trading.venue.${venue}`, fallback: venue })
}

/** Any edit drops the question and the refusals about the old figures. */
export function touch(form: TradeForm): void {
  form.question.value = undefined
  form.refused.value = new Map()
  form.failure.value = undefined
}

/** The draft paths the form shows a field for right now; a refusal for any other goes to the top. */
export function shownPaths(form: TradeForm): readonly string[] {
  const paths = fieldPathsOf(form.kind.value)

  return form.fxRate.value === undefined ? paths : [...paths, 'operatorFxRate']
}

export function messageFor(form: TradeForm, ...paths: readonly string[]): string | undefined {
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
export function useVenues(form: TradeForm): void {
  useEffect(() => {
    const controller = new AbortController()

    getJson(ROUTES.venues, { signal: controller.signal }).then(
      (answer) => {
        form.venues.value = answer.venues
        chooseVenue(form)
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          form.failure.value = describeFailure(error, shownPaths(form))
        }
      }
    )

    return () => controller.abort()
  }, [])
}
