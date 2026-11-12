import { formatDay } from '@/i18n'
import { priceDisplayOf } from '@/web/state/market'
import { locale } from '@/web/state/session'
import {
  formatExactAmount,
  formatMoney,
  formatQuantity,
  formatRecordedMoney,
} from '@/web/text/figures'
import { formatMarketPrice, formatRecordedMarketPrice } from '@/web/text/market-price'
import { tr } from '@/web/text/tr'
import { toVenueName } from '@/web/text/venue'
import { marketCurrency } from '@/web/ui/dialogs/trade-kinds'
import { buildTradeDraft, type TradeForm } from '@/web/ui/dialogs/trade-state'

/** "Sẽ ghi: Mua 100 FPT giá 125,00 (125.000 VND/cp), tổng 12.500.000 VND tại VPS, ngày 22/10/2026."
 *  The per-share price in whole currency shows only where the board scales it; absent until a trade
 *  is complete. */
export function describeTrade(form: TradeForm): string | undefined {
  const build = buildTradeDraft(form)

  if (build.kind === 'invalid' || !('unitPrice' in build.draft)) {
    return undefined
  }

  const { draft } = build
  const { market } = draft.instrument
  const currency = marketCurrency(market)
  const isBoardScaled = priceDisplayOf(market) !== undefined

  return tr(isBoardScaled ? 'ui.office.trade.previewBoard' : 'ui.office.trade.preview', {
    side: tr(`trading.ledger.kind.${draft.kind}`),
    quantity: formatQuantity(draft.quantity),
    ticker: draft.instrument.ticker,
    price:
      currency === undefined
        ? formatMarketPrice(market, draft.unitPrice)
        : formatRecordedMarketPrice(market, draft.unitPrice, currency),
    unit:
      currency === undefined
        ? formatExactAmount(draft.unitPrice)
        : formatRecordedMoney(draft.unitPrice, currency),
    total: totalMoney(draft.quantity * draft.unitPrice, currency),
    venue: toVenueName(draft.venue),
    day: formatDay(locale.value, draft.at),
  })
}

// The price is what the operator typed, so it keeps every digit; the total is worked out, so it
// prints at the currency's own precision like the order prompt's notional.
function totalMoney(value: number, currency: string | undefined): string {
  return currency === undefined ? formatExactAmount(value) : formatMoney(value, currency)
}
