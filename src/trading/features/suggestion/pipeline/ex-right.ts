import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { Caveat, CaveatCode } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { Candle, Quote } from '@/trading/kernel/market/market-data'
import type { MarketEvent, MarketEventKind } from '@/trading/kernel/market/market-event'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { TradingCalendar } from '@/trading/markets/types'
import { tradingDay } from '@/trading/kernel/instrument'
import { parseBranded } from '@/trading/kernel/surface/surface'

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

/** What one ex-date does to the series' newest close, every earlier ex-date of the gap applied. */
interface ExRightStep {
  readonly day: TradingDay
  readonly factor: number
}

/** Corporate actions that went ex after the stored series ends, by the run's day: the exchange's
 *  reference price already stands on the new basis while the bars, the standing plan and a quote
 *  still showing the last close do not, until a refresh restates the series. Keyed on the run's day
 *  rather than the next session, so the evening before still prices against the close it watches.
 *  Actions with published terms are priced the way the exchange adjusts them; one without leaves the
 *  factor unknown. `day` is the newest ex-date: a price standing on it or later is on the new basis. */
export type ExRightGap =
  | {
      readonly kind: 'adjusted'
      readonly day: TradingDay
      readonly factor: number
      readonly steps: readonly ExRightStep[]
    }
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
    quote: quote?.kind === 'available' ? toAdjustedQuoteRead(quote, gap, input.calendar) : quote,
    gap,
    caveats: [{ code: EX_RIGHT_CAVEATS[gap.kind], detail: { day: gap.day } }],
  }
}

function exRightGapOf(candles: readonly Candle[], input: ExRightInput): ExRightGap | undefined {
  const newest = candles[candles.length - 1]

  if (newest === undefined) {
    return undefined
  }

  const events = exRightEventsBetween(input.events, newest.at, input.asOf)
  // An action with no published terms leaves the price unknown (NaN fails both bounds).
  const steps = exRightStepsOf(newest.close, events)
  const last = steps[steps.length - 1]

  if (last === undefined || last.factor === 1) {
    return undefined
  }

  return last.factor > 0 && last.factor < 1
    ? { kind: 'adjusted', day: last.day, factor: last.factor, steps }
    : { kind: 'unadjusted', day: last.day }
}

function exRightEventsBetween(
  events: readonly MarketEvent[],
  after: TradingDay,
  through: TradingDay
): readonly MarketEvent[] {
  return events
    .filter((event) => EX_RIGHT_KINDS.has(event.kind) && event.at > after && event.at <= through)
    .toSorted((left, right) => left.at.localeCompare(right.at))
}

interface FillOnBasisInput {
  readonly price: number
  readonly day: TradingDay
}

interface SeriesBasis {
  readonly events: readonly MarketEvent[]
  /** The newest day the stored series reaches. */
  readonly newestDay: TradingDay
  readonly gap: ExRightGap | undefined
}

/** A fill's price moved onto the series' basis. Ex-dates after the fill that the stored series
 *  already restated scale it from its own price, the way the exchange sets a reference from a
 *  close; the gap's ex-dates scale it from there. A fill an action cannot price stays as filled. */
export function toSeriesBasisPrice(fill: FillOnBasisInput, basis: SeriesBasis): number {
  const restated = exRightEventsBetween(basis.events, fill.day, basis.newestDay)
  const restatedFactor = exRightStepsOf(fill.price, restated).at(-1)?.factor ?? 1
  const gapFactor = basis.gap === undefined ? 1 : basisFactorAt(basis.gap, fill.day)

  return gapFactor === null || !(restatedFactor > 0)
    ? fill.price
    : fill.price * restatedFactor * gapFactor
}

function exRightStepsOf(close: number, events: readonly MarketEvent[]): readonly ExRightStep[] {
  const steps: ExRightStep[] = []
  let reference = close

  for (const day of new Set(events.map((event) => event.at))) {
    reference = referencePriceOf(
      reference,
      events.filter((event) => event.at === day)
    )
    steps.push({ day, factor: reference / close })
  }

  return steps
}

/** The reference price the exchange sets on an ex-date from the close before it. Actions sharing a
 *  day settle in one formula, so row order cannot move it: the cash comes off, and the rights'
 *  subscription money joins the close, before the result is spread over every new share. */
function referencePriceOf(close: number, events: readonly MarketEvent[]): number {
  let cash = 0
  let subscription = 0
  let newShares = 0

  for (const event of events) {
    switch (event.kind) {
      case 'dividend-ex-date':
        cash += event.cashPerShare ?? Number.NaN
        break
      case 'split':
        newShares += event.shareRatio ?? Number.NaN
        break
      case 'rights-issue': {
        const price = event.subscriptionPrice ?? Number.NaN
        const ratio = event.shareRatio ?? Number.NaN

        // Rights priced at or above the close dilute nothing, so the exchange leaves the price alone.
        if (!(price >= close)) {
          subscription += price * ratio
          newShares += ratio
        }

        break
      }
      default:
        return Number.NaN
    }
  }

  return (close - cash + subscription) / (1 + newShares)
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

/** A quote still showing a close from before the ex-date; one the gap cannot price stays as read. */
function toAdjustedQuoteRead(
  quote: Extract<SourceResult<Quote>, { readonly kind: 'available' }>,
  gap: ExRightGap,
  calendar: TradingCalendar
): SourceResult<Quote> {
  const factor = basisFactorAt(gap, calendar.dayAt(quote.value.observedAt))

  return factor === null || factor === 1
    ? quote
    : { ...quote, value: toAdjustedQuote(quote.value, factor) }
}

function toAdjustedQuote(quote: Quote, factor: number): Quote {
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

/** What a price standing on `day`'s basis is multiplied by to stand on the series' new basis: 1
 *  from the gap's newest ex-date on, only the ex-dates after `day` before it, `null` when the
 *  action cannot be priced, since such a price then describes a trade that no longer exists. */
function basisFactorAt(gap: ExRightGap, day: TradingDay): number | null {
  if (day >= gap.day) {
    return 1
  }

  if (gap.kind !== 'adjusted') {
    return null
  }

  const absorbed = gap.steps.findLast((step) => step.day <= day)

  return absorbed === undefined ? gap.factor : gap.factor / absorbed.factor
}

/** What a standing plan's prices are multiplied by to stand on the series' new basis, `null` when
 *  the gap cannot be priced and the plan is not carried. A plan is scaled only by the ex-dates it
 *  has not absorbed. */
export function planBasisFactorOf(
  plan: StoredSuggestion,
  gap: ExRightGap | undefined
): number | null {
  return gap === undefined ? 1 : basisFactorAt(gap, planBasisDayOf(plan))
}

// The newest day its prices stand on: its bars reach it, or the gap it was priced across was
// adjusted through it. A quote alone proves nothing: a plan written on the ex-date from the last
// close still stands on the old basis.
function planBasisDayOf(plan: StoredSuggestion): TradingDay {
  return [plan.evidenceThrough ?? plan.at, ...plan.caveats.flatMap(adjustedDayOf)].reduce(
    (newest, day) => (day > newest ? day : newest)
  )
}

function adjustedDayOf(caveat: Caveat): readonly TradingDay[] {
  const { detail } = caveat
  const day = typeof detail?.day === 'string' ? parseBranded(detail.day, tradingDay) : null

  return caveat.code === EX_RIGHT_CAVEATS.adjusted && day !== null ? [day] : []
}
