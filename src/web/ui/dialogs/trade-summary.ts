import { formatDay } from '@/i18n'
import { priceDisplayOf } from '@/web/state/market'
import { locale } from '@/web/state/session'
import { formatAmount, formatQuantity } from '@/web/text/figures'
import { formatMarketPrice } from '@/web/text/market-price'
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
  const isBoardScaled = priceDisplayOf(market) !== undefined

  return tr(isBoardScaled ? 'ui.office.trade.previewBoard' : 'ui.office.trade.preview', {
    side: tr(`trading.ledger.kind.${draft.kind}`),
    quantity: formatQuantity(draft.quantity),
    ticker: draft.instrument.ticker,
    price: formatMarketPrice(market, draft.unitPrice),
    unit: formatMoney(market, draft.unitPrice),
    total: formatMoney(market, draft.quantity * draft.unitPrice),
    venue: toVenueName(draft.venue),
    day: formatDay(locale.value, draft.at),
  })
}

function formatMoney(market: string, value: number): string {
  const currency = marketCurrency(market)
  const figure = formatAmount(value)

  return currency === undefined ? figure : `${figure} ${currency}`
}
