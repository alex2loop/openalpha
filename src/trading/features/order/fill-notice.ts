import type { Locale } from '@/core/types/locale'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { ExitFillPayload } from '@/trading/kernel/operator/notice'
import { t } from '@/i18n'
import { formatQuantity, renderVenueName } from '@/trading/render/format'
import { formatQuotedPrice } from '@/trading/render/money'

/** What an exit that filled at the exchange says: which leg, and that the ledger holds the sale.
 *  The reason is read off the price when the fill was booked, so a fill with none is the plain
 *  exit. */
export function renderExitFillNotice(locale: Locale, payload: ExitFillPayload): string {
  const { fill } = payload

  return t(locale, `trading.fill.exit.${fill.closeReason ?? 'other'}`, {
    ticker: fill.instrument.ticker,
    venue: renderVenueName(locale, fill.venue),
    quantity: formatQuantity(locale, fill.quantity),
    price: formatQuotedPrice(locale, fill.unitPrice, { currency: fill.currency }),
  })
}

/** A buy that filled, for a surface that was not the one that asked: the `/trade` reply already
 *  tells the operator who placed it, so this carries no figures. */
export function renderEntryFillNotice(
  locale: Locale,
  fill: { readonly instrument: InstrumentRef; readonly venue: string }
): string {
  return t(locale, 'trading.fill.entry', {
    ticker: fill.instrument.ticker,
    venue: renderVenueName(locale, fill.venue),
  })
}
