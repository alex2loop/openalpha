import type { EntryFill } from '@/trading/features/suggestion/pipeline/outcome-locks'
import type { ActionableSuggestion, OutcomeResolution } from '@/trading/features/suggestion/types'
import type { OutcomeStatus } from '@/trading/kernel/conviction'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { MarketPriceLimit } from '@/trading/markets/price-limit'
import type { MarketTrail, TrailBounds } from '@/trading/markets/types'
import { bankedShareOf, firstExitOf } from '@/trading/features/suggestion/exit-plan/first-exit'
import {
  entryFillFor,
  isExitLocked,
  isUnsettled,
} from '@/trading/features/suggestion/pipeline/outcome-locks'
import {
  directionalReturn,
  exitPriceAt,
  exitPriceFor,
  openedBeyondStop,
} from '@/trading/features/suggestion/pipeline/outcome-prices'
import { armsExit } from '@/trading/features/suggestion/types'
import { isBenchmarkCurrent } from '@/trading/markets/timeseries'

/** Multiple of the holding window past which a suggestion expires at its last available bar even
 *  though the source never delivered a full one. Wide enough that a calendar over-counting holidays
 *  can never expire a complete series early. */
export const EXPIRY_BACKSTOP_MULTIPLE = 3

const EXPIRY_NOT_REACHED: OutcomeResolution = Object.freeze({
  kind: 'pending',
  reason: 'expiry-not-reached',
})

const ENTRY_RESTING: OutcomeResolution = Object.freeze({ kind: 'pending', reason: 'entry-resting' })
const UNFILLED: OutcomeResolution = Object.freeze({ kind: 'unscorable', reason: 'never-filled' })

/** The scoring rule that produced a row, stamped on the outcome rather than on the suggestion: the
 *  rule that applies is the one running when the daemon resolves it, which is not the one that was
 *  current when the suggestion was written. `/reflect` groups on it, so two rules never blend into
 *  one win rate. */
export const OUTCOME_FORMULA_VERSION = '1.0.0'

/** What the scorer reads of a call: its levels, how it was framed, and when it could trade. */
type ScoredCall = Pick<
  ActionableSuggestion,
  | 'action'
  | 'at'
  | 'entry'
  | 'stop'
  | 'target'
  | 'takeProfit'
  | 'takeProfitTranchePct'
  | 'reviewOnly'
  | 'settlement'
  | 'orderSession'
  | 'restingEntry'
  | 'quote'
  | 'priceBand'
>

interface OutcomeInput {
  readonly suggestion: ScoredCall
  /** Ascending by day, the market's own adjusted series. */
  readonly bars: readonly Candle[]
  readonly maximumHoldingSessions: number
  /** Calendar sessions since the suggestion's own session, so a series the source cannot complete
   *  still expires instead of staying pending forever. */
  readonly elapsedSessions: number
  readonly benchmarkBars?: readonly Candle[]
  /** The session the entry price was printed in. Absent where the call priced off no quote, which
   *  reads as a settled close rather than a live print. */
  readonly entrySession?: TradingDay
  /** Entry plus exit commission, spread and tax at the venue this market books to, as a fraction. */
  readonly roundTripFeeFraction: number
  readonly now: number
  /** What a long's stop trails on from its first session. `bars` then carries that many sessions
   *  before the suggestion, so the first level reads a full series. */
  readonly trail?: MarketTrail
  /** What the trailed stop is held to, as the exit tick holds it. */
  readonly trailBounds: TrailBounds
  /** The market's own limit rule. Absent where the exchange sets none, and a session is then never
   *  locked. */
  readonly priceLimit?: MarketPriceLimit
  /** The session a limit lock rolled the entry to, set by the scorer itself. */
  readonly rolledTo?: TradingDay
  /** Set by the scorer when a resting limit's fill bar opened under the limit: the fill was at the
   *  open, so everything the bar printed came after it. */
  readonly filledAtOpen?: true
}

/** The holding window, and where it starts in the full series the trail reads. `sessions` counts
 *  only the sessions after the suggestion's own, which is what the window is measured in. */
interface HoldingWindow {
  readonly bars: readonly Candle[]
  readonly start: number
  readonly sessions: number
}

interface OutcomeExit {
  readonly status: OutcomeStatus
  readonly bar: Candle
  readonly returnPct: number
}

export function resolveOutcome(input: OutcomeInput): OutcomeResolution {
  const opened = holdingWindowOf(input)

  if (opened.bars.length === 0) {
    return { kind: 'pending', reason: 'insufficient-bars' }
  }

  const fill = entryFillFor(input, opened)

  if (fill.kind === 'resting') {
    return isExpired(input, opened) ? UNFILLED : ENTRY_RESTING
  }

  if (fill.kind === 'shut') {
    return neverFilled(input, opened)
  }

  const entered = enterAt(input, opened, fill)

  return fill.kind === 'unsettled'
    ? expiredAtLastClose(entered.input, entered.window)
    : scoreWindow(entered.input, entered.window)
}

function scoreWindow(input: OutcomeInput, window: HoldingWindow): OutcomeResolution {
  // A review level has nothing armed under it, so only the target or the
  // window's last close ends the call.
  const stopped = armsExit(input.suggestion)
  const profit = profitLevelOf(input)
  let stop = input.suggestion.stop
  // A resting limit's stop goes on at its fill, so the fill bar keeps the plan's stop.
  const trailFrom = input.suggestion.restingEntry === undefined ? 0 : 1
  // A bar that opened at or above the limit filled partway through, and a daily bar cannot say
  // whether its high printed before that: the target is read from the next bar, as a stop is read
  // before a target.
  const targetFrom = trailFrom === 0 || input.filledAtOpen === true ? 0 : 1

  for (const [index, bar] of window.bars.entries()) {
    stop = index < trailFrom ? stop : trailedStop(input, window.start + index, stop)

    if (isUnsettled(bar, input.suggestion) || isExitLocked(input, window.start + index)) {
      continue
    }

    // Stop before target within one candle: a daily bar cannot say which extreme came first, and
    // the conservative reading is the one that does not flatter the record.
    if (stopped && crossedStop(bar, input.suggestion, stop)) {
      return stoppedOut(bar, input, stop)
    }

    if (index >= targetFrom && crossedLevel(bar, input.suggestion, profit)) {
      return resolveTarget(input, window, { index, stop })
    }
  }

  return expiredAtLastClose(input, window)
}

/** The window keeps its length: the call's clock started when it was made, not when it filled. */
function enterAt(
  input: OutcomeInput,
  window: HoldingWindow,
  fill: Exclude<EntryFill, { readonly kind: 'shut' | 'resting' }>
): { readonly input: OutcomeInput; readonly window: HoldingWindow } {
  const { settlement, restingEntry } = input.suggestion
  // A limit that the order session opened under fills at that open, even on the first bar.
  const gappedUnder = restingEntry !== undefined && fill.entry < input.suggestion.entry

  if (fill.offset === 0 && !gappedUnder) {
    return { input, window }
  }

  const moved = fill.kind === 'filled' ? fill.sellableFrom : undefined

  return {
    input: {
      ...input,
      rolledTo: fill.session,
      ...(gappedUnder ? { filledAtOpen: true as const } : {}),
      suggestion: {
        ...input.suggestion,
        entry: fill.entry,
        ...(settlement === undefined || moved === undefined
          ? {}
          : { settlement: { ...settlement, sellableFrom: moved } }),
      },
    },
    window: {
      bars: window.bars.slice(fill.offset),
      start: window.start + fill.offset,
      sessions: window.sessions,
    },
  }
}

/** No trade happened, so there is no result and no fee: the row closes outside every score. A lapsed
 *  limit is known at once; a lock-out only once the whole window has passed. */
function neverFilled(input: OutcomeInput, window: HoldingWindow): OutcomeResolution {
  return input.suggestion.restingEntry !== undefined || isExpired(input, window)
    ? UNFILLED
    : EXPIRY_NOT_REACHED
}

function expiredAtLastClose(input: OutcomeInput, window: HoldingWindow): OutcomeResolution {
  const last = window.bars.at(-1)

  return isExpired(input, window) && last !== undefined
    ? resolved('expired', last, input)
    : EXPIRY_NOT_REACHED
}

/** At most the configured window: a stop hit at session 40 must not resolve a suggestion that
 *  expired at session 20. It counts from the session after the suggestion's own, whose bar the
 *  levels were derived from - except where the order trades that session itself: from the entry
 *  where the entry was a live price inside it, and from its open where it was not, since an order
 *  placed before the open lives through the gap a call made after the close would also meet. */
function holdingWindowOf(input: OutcomeInput): HoldingWindow {
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
function tradesWholeSession(input: OutcomeInput): boolean {
  const { suggestion } = input

  return suggestion.orderSession === suggestion.at && input.entrySession !== suggestion.at
}

/** A live entry fills inside a session whose daily bar also holds the prices printed before it, so
 *  only the path the fill must have travelled is known: from the entry to that session's close. A
 *  level that close is already through was crossed after the fill, at the level. Skipping the
 *  session instead scored a whole session of movement with no stop or target watching it. */
function fillSessionOf(
  input: OutcomeInput
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

/** Bar count is the real window and settles a complete series; elapsed sessions only catch one the
 *  source never completes, which the bar count alone would leave pending forever. */
function isExpired(input: OutcomeInput, window: HoldingWindow): boolean {
  return (
    window.sessions >= input.maximumHoldingSessions ||
    input.elapsedSessions >= input.maximumHoldingSessions * EXPIRY_BACKSTOP_MULTIPLE
  )
}

/** The plan banks its tranche at the take-profit and lets the rest ride the trail, so the row is
 *  graded on both legs. Until the rest is closed or the window ends, the call stays pending. */
function resolveTarget(
  input: OutcomeInput,
  window: HoldingWindow,
  at: { readonly index: number; readonly stop: number }
): OutcomeResolution {
  const { index } = at
  const bar = window.bars[index]

  if (bar === undefined) {
    return EXPIRY_NOT_REACHED
  }

  const banked = bankedShareOf(input.suggestion, input.trail !== undefined)

  if (banked >= 1) {
    return resolved('target', bar, input)
  }

  const rest = runnerExitOf(input, window, at)

  if (rest === undefined) {
    return EXPIRY_NOT_REACHED
  }

  const { suggestion, roundTripFeeFraction: fee } = input
  const bankedPrice = exitPriceAt(bar, suggestion, profitLevelOf(input))
  const bankedReturn = directionalReturn(suggestion, bankedPrice, fee)
  const restReturn = directionalReturn(suggestion, rest.price, fee)

  return outcomeOf(input, {
    status: 'target',
    bar: rest.bar,
    returnPct: banked * bankedReturn + (1 - banked) * restReturn,
  })
}

function profitLevelOf(input: OutcomeInput): number {
  return firstExitOf(input.suggestion, bankedShareOf(input.suggestion, input.trail !== undefined))
}

/** The rest leaves on the first touch of the trailed stop, or at the window's last close. */
function runnerExitOf(
  input: OutcomeInput,
  window: HoldingWindow,
  at: { readonly index: number; readonly stop: number }
): { readonly bar: Candle; readonly price: number } | undefined {
  let level = at.stop

  for (let next = at.index + 1; next < window.bars.length; next += 1) {
    const bar = window.bars[next]

    if (bar === undefined) {
      break
    }

    level = trailedStop(input, window.start + next, level)

    if (isExitLocked(input, window.start + next)) {
      continue
    }

    if (bar.low <= level) {
      return { bar, price: Math.min(bar.open, level) }
    }
  }

  const last = window.bars.at(-1)

  return isExpired(input, window) && last !== undefined
    ? { bar: last, price: last.close }
    : undefined
}

/** A long's stop as the exit tick moves it: the trail read off the closes before this session,
 *  raised only upward and only below the last close. A sale and a review level have nothing to
 *  trail. */
function trailedStop(input: OutcomeInput, session: number, level: number): number {
  const { suggestion, trail } = input

  if (trail === undefined || suggestion.action !== 'buy' || !armsExit(suggestion)) {
    return level
  }

  const history = input.bars.slice(0, session)
  const trailed = trail.stopFor(history, input.trailBounds)
  const close = history.at(-1)?.close

  if (trailed === undefined || close === undefined || trailed <= level || trailed >= close) {
    return level
  }

  return trailed
}

function crossedStop(bar: Candle, suggestion: ScoredCall, stop: number): boolean {
  return suggestion.action === 'buy' ? bar.low <= stop : bar.high >= stop
}

/** Strictly through, where the stop is satisfied by a touch. A stop is a market order once it
 *  triggers, so reaching it is enough; a target is a resting limit that needs someone to lift it,
 *  and a session whose extreme merely equals it is the market passing the price, not paying it.
 *  Treating both as fills scored one side at its worst case and the other at its best. */
function crossedLevel(bar: Candle, suggestion: ScoredCall, level: number): boolean {
  return suggestion.action === 'buy' ? bar.high > level : bar.low < level
}

function resolved(
  status: Exclude<OutcomeStatus, 'stop'>,
  bar: Candle,
  input: OutcomeInput
): OutcomeResolution {
  const exitPrice = exitPriceFor(status, bar, input.suggestion)

  return outcomeOf(input, {
    status,
    bar,
    returnPct: directionalReturn(input.suggestion, exitPrice, input.roundTripFeeFraction),
  })
}

/** A stop is a market order once touched, so it fills at the level, or at the open that gapped
 *  through it. */
function stoppedOut(bar: Candle, input: OutcomeInput, stop: number): OutcomeResolution {
  const exitPrice = openedBeyondStop(bar, input.suggestion, stop) ? bar.open : stop

  return outcomeOf(input, {
    status: 'stop',
    bar,
    returnPct: directionalReturn(input.suggestion, exitPrice, input.roundTripFeeFraction),
  })
}

function outcomeOf(input: OutcomeInput, exit: OutcomeExit): OutcomeResolution {
  const benchmarkReturnPct = benchmarkReturn(input, exit.bar)

  return {
    kind: 'resolved',
    outcome: {
      status: exit.status,
      resolvedAt: input.now,
      exitDay: exit.bar.at,
      returnPct: exit.returnPct,
      formulaVersion: OUTCOME_FORMULA_VERSION,
      ...(benchmarkReturnPct === undefined ? {} : { benchmarkReturnPct }),
    },
  }
}

/** Anchored on the close the call's own window starts from, never a session later: the benchmark
 *  opens on its last close before the first session the order trades - the one before the
 *  suggestion's own session where the order trades it, the suggestion's own otherwise, the one
 *  before the fill where a limit lock rolled it - and closes on its last at or before the exit. Opened on the first close after a weekend or pre-open call,
 *  it skipped a session the call itself was scored on. A series whose days do not line up exactly
 *  is common — one provider gap is enough — and dropping the comparison for it loses the benchmark
 *  on exactly the runs that most need one; a series further behind than that has no comparison. */
function benchmarkReturn(input: OutcomeInput, exitBar: Candle): number | undefined {
  const bars = input.benchmarkBars ?? []
  const { suggestion } = input
  const tradesOn =
    input.rolledTo ?? (suggestion.orderSession === suggestion.at ? suggestion.at : undefined)
  const start =
    tradesOn === undefined
      ? bars.findLast((bar) => bar.at <= suggestion.at)
      : bars.findLast((bar) => bar.at < tradesOn)
  const end = bars.findLast((bar) => bar.at <= exitBar.at)

  if (
    start === undefined ||
    end === undefined ||
    start.close <= 0 ||
    end.at <= start.at ||
    !isBenchmarkCurrent(input.bars, end.at, exitBar.at)
  ) {
    return undefined
  }

  const move = end.close / start.close - 1

  return input.suggestion.action === 'buy' ? move : -move
}
