import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { Caveat, CaveatCode } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { Candle, Quote } from '@/trading/kernel/market/market-data'
import type { MarketEvent, MarketEventKind } from '@/trading/kernel/market/market-event'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { TradingCalendar } from '@/trading/markets/types'

// The corporate actions that move the reference price on their ex-date.
const EX_RIGHT_KINDS: ReadonlySet<MarketEventKind> = new Set([
  'dividend-ex-date',
  'split',
  'rights-issue',
])

const EX_RIGHT_CAVEATS = Object.freeze({
  adjusted: 'suggestion.levels-ex-adjusted',
  unadjusted: 'suggestion.levels-ex-unadjusted',
} as const satisfies Record<ExRightGap['kind'], CaveatCode>)

/** A corporate action that went ex after the stored series ends, by the run's day: the exchange's
 *  reference price already stands on the new basis while the bars, the standing plan and a quote
 *  still showing the last close do not, until a refresh restates the series. Keyed on the run's day
 *  rather than the next session, so the evening before still prices against the close it watches.
 *  An action with published terms is priced the way the exchange adjusts it; one without leaves the
 *  factor unknown. */
export type ExRightGap =
  | { readonly kind: 'adjusted'; readonly day: TradingDay; readonly factor: number }
  | { readonly kind: 'unadjusted'; readonly day: TradingDay }

interface ExRightInput {
  readonly events: readonly MarketEvent[]
  readonly asOf: TradingDay
  readonly calendar: TradingCalendar
}

interface ExRightRead {
  readonly bars: SourceResult<readonly Candle[]> | undefined
  readonly quote: SourceResult<Quote> | undefined
}

interface ExRightAdjusted extends ExRightRead {
  readonly gap?: ExRightGap
  readonly caveats: readonly Caveat[]
}

/** The stored series, and a quote still showing a close from before the ex-date, moved onto the new
 *  basis; the gap they closed, and the note that says so. */
export function adjustForExRight(read: ExRightRead, input: ExRightInput): ExRightAdjusted {
  const { bars, quote } = read

  if (bars?.kind !== 'available') {
    return { ...read, caveats: [] }
  }

  const gap = exRightGapOf(bars.value, input)

  if (gap === undefined) {
    return { ...read, caveats: [] }
  }

  return {
    bars: { ...bars, value: toAdjustedCandles(bars.value, gap) },
    quote:
      quote?.kind === 'available' && input.calendar.dayAt(quote.value.observedAt) < gap.day
        ? { ...quote, value: toAdjustedQuote(quote.value, gap) }
        : quote,
    gap,
    caveats: [{ code: EX_RIGHT_CAVEATS[gap.kind], detail: { day: gap.day } }],
  }
}

function exRightGapOf(candles: readonly Candle[], input: ExRightInput): ExRightGap | undefined {
  const newest = candles[candles.length - 1]

  if (newest === undefined) {
    return undefined
  }

  const gap = input.events.filter(
    (event) => EX_RIGHT_KINDS.has(event.kind) && event.at > newest.at && event.at <= input.asOf
  )
  const first = gap[0]

  if (first === undefined) {
    return undefined
  }

  // An action with no published terms leaves the price unknown (NaN fails both bounds).
  const reference = gap.reduce((price, event) => exRightPriceOf(price, event), newest.close)
  const factor = reference / newest.close

  if (factor === 1) {
    return undefined
  }

  return factor > 0 && factor < 1
    ? { kind: 'adjusted', day: first.at, factor }
    : { kind: 'unadjusted', day: first.at }
}

/** The reference price the exchange sets on the ex-date from the close before it: less the cash, the
 *  close spread over the new shares, or the rights' subscription money added to it first. */
function exRightPriceOf(close: number, event: MarketEvent): number {
  switch (event.kind) {
    case 'dividend-ex-date':
      return close - (event.cashPerShare ?? Number.NaN)
    case 'split':
      return close / (1 + (event.shareRatio ?? Number.NaN))
    case 'rights-issue':
      return rightsPriceOf(close, event)
    default:
      return Number.NaN
  }
}

// Rights priced at or above the close dilute nothing, so the exchange leaves the price alone.
function rightsPriceOf(
  close: number,
  terms: Pick<MarketEvent, 'shareRatio' | 'subscriptionPrice'>
): number {
  const ratio = terms.shareRatio ?? Number.NaN
  const price = terms.subscriptionPrice ?? Number.NaN

  return price >= close ? close : (close + price * ratio) / (1 + ratio)
}

/** The series as the provider will restate it: every price scaled to the reference price, volume
 *  and turnover as traded. */
function toAdjustedCandles(candles: readonly Candle[], gap: ExRightGap): readonly Candle[] {
  if (gap.kind !== 'adjusted') {
    return candles
  }

  const { factor } = gap

  return candles.map((candle) => ({
    ...candle,
    open: candle.open * factor,
    high: candle.high * factor,
    low: candle.low * factor,
    close: candle.close * factor,
  }))
}

function toAdjustedQuote(quote: Quote, gap: ExRightGap): Quote {
  if (gap.kind !== 'adjusted') {
    return quote
  }

  const { factor } = gap
  const { board, session } = quote

  return {
    ...quote,
    price: quote.price * factor,
    ...(board === undefined
      ? {}
      : {
          board: {
            ...board,
            buyPrice: board.buyPrice * factor,
            sellPrice: board.sellPrice * factor,
          },
        }),
    ...(session === undefined
      ? {}
      : { session: { ...session, high: session.high * factor, low: session.low * factor } }),
  }
}

/** What a standing plan's prices are multiplied by to stand on the series' new basis: 1 for a plan
 *  priced on or after the ex-date, `null` when the action cannot be priced, since the old levels
 *  then describe a trade that no longer exists and none is carried. */
export function planBasisFactorOf(
  plan: StoredSuggestion,
  gap: ExRightGap | undefined
): number | null {
  if (gap === undefined || isOnNewBasis(plan, gap)) {
    return 1
  }

  return gap.kind === 'adjusted' ? gap.factor : null
}

// Its bars already reach the ex-date, or this gap was priced out when it was made. A quote alone
// proves nothing: a plan written on the ex-date from the last close still stands on the old basis.
function isOnNewBasis(plan: StoredSuggestion, gap: ExRightGap): boolean {
  return (
    (plan.evidenceThrough ?? plan.at) >= gap.day ||
    plan.caveats.some(
      (caveat) => caveat.code === EX_RIGHT_CAVEATS.adjusted && caveat.detail?.day === gap.day
    )
  )
}
