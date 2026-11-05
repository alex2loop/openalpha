import type { DealerBoardWire } from '@/app/server/wire/quote-detail'
import { findMarket, priceDisplayOf, printDisplayOf } from '@/web/state/market'
import { formatFixedFraction, formatPrice, WHOLE_DISPLAY } from '@/web/text/figures'
import { ABSENT_CELL, joinInline } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'

// Rounds away the binary noise of a product like 27.8 x 1000.
const WHOLE_UNIT_PRECISION = 1_000_000
const TICK_DIGITS_MAX = 8
const TICK_TOLERANCE = 1e-6

/** What a price's reading says of its name: a quote, or the facts drawn from one. */
interface LevelReading {
  readonly isLevel?: boolean
}

/** A price as its market prints it: a board-scaled market without a currency, any other beside its
 *  currency. An index publishes a level, which has no board scale and no currency. */
export function formatMarketPrice(
  market: string,
  value: number | undefined,
  reading?: LevelReading
): string {
  if (value === undefined) {
    return ABSENT_CELL
  }

  return withCurrency(market, formatBarePrice(market, value, reading), reading)
}

/** A dealer's two sides, each labelled, with the currency said once after them where the market has
 *  no board scale, and the gap between them where the board gives one. */
export function formatDealerBoard(
  market: string,
  board: DealerBoardWire
): { readonly sides: string; readonly spread?: string } {
  const display = printDisplayOf(market)
  const sides = joinInline([
    tr('ui.office.dealer.buy', { price: formatPrice(board.buyPrice, display) }),
    tr('ui.office.dealer.sell', { price: formatPrice(board.sellPrice, display) }),
  ])

  return {
    sides: withCurrency(market, sides),
    ...(board.spread === undefined
      ? {}
      : { spread: tr('ui.office.dealer.spread', { spread: formatFixedFraction(board.spread) }) }),
  }
}

function withCurrency(market: string, price: string, reading?: LevelReading): string {
  const currency = findMarket(market)?.currency

  return reading?.isLevel !== true && priceDisplayOf(market) === undefined && currency !== undefined
    ? `${price} ${currency}`
    : price
}

/** Prints a chart tick: the board's figure at only the decimals its spacing needs, so a whole step
 *  prints no `,00`. */
export function toTickFormatter(
  market: string,
  reading?: LevelReading
): (value: number, step: number) => string {
  const display = displayOf(market, reading)
  const divisor = display?.divisor ?? 1

  return (value, step) => formatPrice(value, { divisor, decimals: decimalsOf(step / divisor) })
}

// The fewest decimals that write the step exactly, up to the most a tick ever needs.
function decimalsOf(step: number): number {
  for (let digits = 0; digits < TICK_DIGITS_MAX; digits++) {
    const scaled = step * 10 ** digits

    if (Math.abs(Math.round(scaled) - scaled) < TICK_TOLERANCE) {
      return digits
    }
  }

  return TICK_DIGITS_MAX
}

// The figure alone, in the market's board scale, for a place the currency is said once nearby.
function formatBarePrice(market: string, value: number, reading?: LevelReading): string {
  return formatPrice(value, displayOf(market, reading))
}

function displayOf(market: string, reading?: LevelReading): ReturnType<typeof printDisplayOf> {
  return reading?.isLevel === true ? undefined : printDisplayOf(market)
}

/** A price typed as the board prints it, in the whole currency units the daemon takes: a VN share
 *  typed 27,80 is 27800. A market with no board scale takes the price as it is. */
export function toWholeUnits(market: string, typed: number): number {
  const divisor = priceDisplayOf(market)?.divisor ?? 1

  return Math.round(typed * divisor * WHOLE_UNIT_PRECISION) / WHOLE_UNIT_PRECISION
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
