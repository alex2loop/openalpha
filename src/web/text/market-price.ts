import { findMarket, priceDisplayOf } from '@/web/state/market'
import { formatPrice, WHOLE_DISPLAY } from '@/web/text/figures'
import { ABSENT_CELL } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'

const INDEX_KIND = 'index'

/** A price as its market prints it: a board-scaled market without a currency, any other beside its
 *  currency. An index publishes a level, which has no board scale and no currency. */
export function formatMarketPrice(
  market: string,
  value: number | undefined,
  kind?: string
): string {
  if (value === undefined) {
    return ABSENT_CELL
  }

  if (kind === INDEX_KIND) {
    return formatPrice(value, undefined)
  }

  const display = priceDisplayOf(market)
  const price = formatPrice(value, display)
  const currency = findMarket(market)?.currency

  return display === undefined && currency !== undefined ? `${price} ${currency}` : price
}

/** "giá bảng điện, x1.000 VND" for a board-scaled market; absent for any other. */
function boardScaleNote(market: string): string | undefined {
  const found = findMarket(market)

  if (found?.priceDisplay === undefined) {
    return undefined
  }

  return tr('ui.office.ticker.boardScale', {
    divisor: formatPrice(found.priceDisplay.divisor, WHOLE_DISPLAY),
    currency: found.currency,
  })
}

/** The scale notes of the markets a list prints, each once. */
export function boardScaleNotes(markets: readonly string[]): readonly string[] {
  const notes = [...new Set(markets)].flatMap((market) => boardScaleNote(market) ?? [])

  return [...new Set(notes)]
}
