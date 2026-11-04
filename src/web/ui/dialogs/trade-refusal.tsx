import type { ApiFailure } from '@/web/api/client'
import type { LedgerDraft } from '@/web/state/trade'
import type { PreviewRefusal, TradeForm } from '@/web/ui/dialogs/trade-state'
import { formatDay } from '@/i18n'
import { locale } from '@/web/state/session'
import { formatMarketPrice } from '@/web/text/market-price'
import { tr } from '@/web/text/tr'
import { toVenueName } from '@/web/text/venue'
import { pickKind } from '@/web/ui/dialogs/trade-fields'
import { currencyOf } from '@/web/ui/dialogs/trade-kinds'
import { Button } from '@/web/ui/kit/button'

// The daemon files a cash shortfall under the amount, as the save does.
const CASH_PATH = 'amount'

/** The book's refusal of a draft, as the preview answered it; absent when it gave no message. A cash
 *  shortfall also names the cash to put there first. */
export function toPreviewRefusal(
  draft: LedgerDraft,
  failure: ApiFailure
): PreviewRefusal | undefined {
  const message =
    failure.fields.length > 0
      ? failure.fields.map((field) => field.message).join(' ')
      : failure.message

  if (message === '') {
    return undefined
  }

  const currency = currencyOf(draft)
  const venue = draft.kind === 'transfer' ? draft.fromVenue : draft.venue
  const isShort = failure.fields.some((field) => field.path === CASH_PATH)

  return isShort && currency !== undefined ? { message, deposit: { venue, currency } } : { message }
}

/** The preview's refusal under "Sẽ ghi": a warning, since the save asks the daemon again and has the
 *  last word. A cash shortfall offers Nạp tiền for the venue and currency it names. */
export function PreviewRefusalNote({ form }: { readonly form: TradeForm }) {
  const refusal = form.refusal.value

  if (refusal === undefined) {
    return null
  }

  const { deposit } = refusal

  return (
    <div class="strip is-caution" role="alert">
      <span>{refusal.message}</span>
      {deposit !== undefined && (
        <Button size="small" onClick={() => openDeposit(form, deposit)}>
          {tr('ui.office.trade.depositFirst', {
            currency: deposit.currency,
            venue: toVenueName(deposit.venue),
          })}
        </Button>
      )}
    </div>
  )
}

/** The typed price against the market's own, when the daemon found them too far apart: a warning,
 *  since the save asks the operator to confirm the price and has the last word. */
export function FarPriceNote({ form }: { readonly form: TradeForm }) {
  const far = form.farPrice.value

  if (far === undefined) {
    return null
  }

  const { market, ticker } = far.instrument

  return (
    <div class="strip is-caution" role="alert">
      <span>
        {tr('ui.office.trade.priceFar', {
          ticker,
          price: formatMarketPrice(market, far.price),
          latest: formatMarketPrice(market, far.latest.price),
          day: formatDay(locale.value, far.latest.at),
        })}
      </span>
    </div>
  )
}

// Khác > Nạp tiền in this dialog: what was typed stays in the form for the way back through Mua.
function openDeposit(form: TradeForm, deposit: NonNullable<PreviewRefusal['deposit']>): void {
  form.venue.value = deposit.venue
  form.currency.value = deposit.currency
  pickKind(form, 'deposit')
}
