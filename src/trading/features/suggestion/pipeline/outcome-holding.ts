import type { ActionableSuggestion } from '@/trading/features/suggestion/types'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { TradingCalendar } from '@/trading/markets/types'

/** What the holding window reads of a call. */
export interface HoldingWindowInput {
  readonly suggestion: Pick<
    ActionableSuggestion,
    'at' | 'entry' | 'orderSession' | 'restingEntry' | 'quote'
  >
  /** Ascending by day, the market's own adjusted series. */
  readonly bars: readonly Candle[]
  readonly maximumHoldingSessions: number
  /** The session the entry price was printed in. Absent where the call priced off no quote, which
   *  reads as a settled close rather than a live print. */
  readonly entrySession?: TradingDay
}

/** The holding window, and where it starts in the full series the trail reads. `sessions` counts
 *  only the sessions after the suggestion's own, which is what the window is measured in. */
export interface HoldingWindow {
  readonly bars: readonly Candle[]
  readonly start: number
  readonly sessions: number
}

/** The session the entry price was printed in, for the input to spread; absent where the call
 *  priced off no quote. */
export function entrySessionOf(
  calendar: TradingCalendar,
  suggestion: Pick<ActionableSuggestion, 'quote'>
): Pick<HoldingWindowInput, 'entrySession'> {
  return suggestion.quote === undefined
    ? {}
    : { entrySession: calendar.dayAt(suggestion.quote.observedAt) }
}

/** At most the configured window: a stop hit at session 40 must not resolve a suggestion that
 *  expired at session 20. It counts from the session after the suggestion's own, whose bar the
 *  levels were derived from - except where the order trades that session itself: from the entry
 *  where the entry was a live price inside it, and from its open where it was not, since an order
 *  placed before the open lives through the gap a call made after the close would also meet. */
export function holdingWindowOf(input: HoldingWindowInput): HoldingWindow {
  const whole = tradesWholeSession(input)
  const start = input.bars.findIndex((bar) =>
    whole ? bar.at >= input.suggestion.at : bar.at > input.suggestion.at
  )
  const after = start < 0 ? [] : input.bars.slice(start, start + input.maximumHoldingSessions)
  const filled = whole ? undefined : fillSessionOf(input)

  return filled === undefined
    ? { bars: after, start, sessions: after.length }
    : { bars: [filled.bar, ...after], start: filled.index, sessions: after.length }
}

/** An order trading in the suggestion's own session on a price that session never printed - a
 *  close, read before the open - meets the whole of that session. */
function tradesWholeSession(input: HoldingWindowInput): boolean {
  const { suggestion } = input

  return suggestion.orderSession === suggestion.at && input.entrySession !== suggestion.at
}

/** A live entry fills inside a session whose daily bar also holds the prices printed before it, so
 *  only the path the fill must have travelled is known: from the entry to that session's close. A
 *  level that close is already through was crossed after the fill, at the level. Skipping the
 *  session instead scored a whole session of movement with no stop or target watching it. */
function fillSessionOf(
  input: HoldingWindowInput
): { readonly bar: Candle; readonly index: number } | undefined {
  const { suggestion } = input
  const index = input.bars.findIndex((bar) => bar.at === suggestion.at)
  const own = input.bars[index]

  if (own === undefined || suggestion.orderSession !== suggestion.at) {
    return undefined
  }

  // The session's own low may print before the order existed, so the call day counts only the move
  // from the price the order went in at to the close.
  const placed =
    suggestion.restingEntry === undefined
      ? suggestion.entry
      : (suggestion.quote?.price ?? suggestion.entry)

  return {
    index,
    bar: {
      ...own,
      open: placed,
      high: Math.max(placed, own.close),
      low: Math.min(placed, own.close),
    },
  }
}
