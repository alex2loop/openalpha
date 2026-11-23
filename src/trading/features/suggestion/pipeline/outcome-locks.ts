import type { ActionableSuggestion, RestingEntry } from '@/trading/features/suggestion/types'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { LimitLock, MarketPriceLimit } from '@/trading/markets/price-limit'

interface LockInput {
  readonly suggestion: Pick<
    ActionableSuggestion,
    'action' | 'priceBand' | 'settlement' | 'entry' | 'restingEntry'
  >
  readonly bars: readonly Candle[]
  readonly priceLimit?: MarketPriceLimit
}

interface SessionWindow {
  readonly bars: readonly Candle[]
  readonly start: number
}

/** Where the order actually trades. `offset` is the fill's place in the window and `session` its
 *  day. `sellableFrom` is present when a later fill moved the day the purchase settles.
 *  `unsettled` is a fill so late that the purchase cannot settle before the window closes. `shut`
 *  never traded: locked out the whole window, or a limit gone past its last day. `resting` is a
 *  limit still waiting inside its days. */
export type EntryFill =
  | { readonly kind: 'shut' }
  | { readonly kind: 'resting' }
  | {
      readonly kind: 'filled'
      readonly offset: number
      readonly session: TradingDay
      readonly entry: number
      readonly sellableFrom?: TradingDay
    }
  | {
      readonly kind: 'unsettled'
      readonly offset: number
      readonly session: TradingDay
      readonly entry: number
    }

/** Nothing can be sold before the purchase settles, so a level crossed then exits nothing; a stop
 *  still crossed once it unlocks leaves at that session's open. */
export function isUnsettled(
  bar: Candle,
  suggestion: Pick<ActionableSuggestion, 'settlement'>
): boolean {
  const sellableFrom = suggestion.settlement?.sellableFrom

  return sellableFrom !== undefined && bar.at < sellableFrom
}

/** A long's way out is a sale, which a floor with no buyers cannot fill. */
export function isExitLocked(input: LockInput, session: number): boolean {
  return limitLockAt(input, session) === (input.suggestion.action === 'buy' ? 'floor' : 'ceiling')
}

/** Where the order trades: a resting limit by its own rule, anything else by the limit locks. */
export function entryFillFor(input: LockInput, window: SessionWindow): EntryFill {
  const { restingEntry } = input.suggestion

  return restingEntry === undefined
    ? entryFillOf(input, window)
    : restingFillOf(input, restingEntry, window)
}

/** A buy needs a seller and a reduce needs a buyer. An entry the limit shut out fills at the open
 *  of the first session that trades its side. */
function entryFillOf(input: LockInput, window: SessionWindow): EntryFill {
  const offset = window.bars.findIndex((_, index) => !isEntryLocked(input, window.start + index))
  const bar = window.bars[offset]

  if (bar === undefined) {
    return { kind: 'shut' }
  }

  return settledFill(
    window,
    { offset, session: bar.at, entry: bar.open },
    input.suggestion.settlement?.sellableFrom
  )
}

/** A resting buy fills on the first session that trades below it - a touch is no fill, as with a
 *  target - and at that session's open where it opened below. Past `until` with no such session the
 *  order is gone; before it, still resting. */
function restingFillOf(
  input: LockInput,
  restingEntry: RestingEntry,
  window: SessionWindow
): EntryFill {
  const { entry, settlement } = input.suggestion
  const offset = window.bars.findIndex(
    (session, index) =>
      session.at <= restingEntry.until &&
      session.low < entry &&
      !isEntryLocked(input, window.start + index)
  )
  const bar = window.bars[offset]

  if (bar !== undefined) {
    return settledFill(
      window,
      { offset, session: bar.at, entry: Math.min(entry, bar.open) },
      settlement?.sellableFrom
    )
  }

  return window.bars.some((session) => session.at >= restingEntry.until)
    ? { kind: 'shut' }
    : { kind: 'resting' }
}

/** A buy needs a seller, which a ceiling with none cannot give; a reduce needs a buyer. */
function isEntryLocked(input: LockInput, session: number): boolean {
  return limitLockAt(input, session) === (input.suggestion.action === 'buy' ? 'ceiling' : 'floor')
}

/** T+N counts from the fill, so a later fill moves the day the purchase can be sold by the same
 *  number of sessions. `sellableFrom` is the day it settles for a fill on the window's first
 *  session. */
function settledFill(
  window: SessionWindow,
  fill: { readonly offset: number; readonly session: TradingDay; readonly entry: number },
  sellableFrom: TradingDay | undefined
): EntryFill {
  if (fill.offset === 0 || sellableFrom === undefined) {
    return { kind: 'filled', ...fill }
  }

  const lag = window.bars.filter((session) => session.at < sellableFrom).length
  const settles = window.bars[fill.offset + lag]

  return settles === undefined
    ? { kind: 'unsettled', ...fill }
    : { kind: 'filled', ...fill, sellableFrom: settles.at }
}

function limitLockAt(input: LockInput, session: number): LimitLock | undefined {
  const band = input.suggestion.priceBand
  const bar = input.bars[session]
  const previous = input.bars[session - 1]

  if (
    input.priceLimit === undefined ||
    band === undefined ||
    bar === undefined ||
    previous === undefined
  ) {
    return undefined
  }

  return input.priceLimit.lockOf(bar, previous.close, band)
}
