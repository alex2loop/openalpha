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
  const { restingEntry, entry } = input.suggestion

  return restingEntry === undefined
    ? entryFillOf(input, window)
    : restingFillOf({ entry, restingEntry }, window)
}

/** A buy needs a seller and a reduce needs a buyer. An entry the limit shut out fills at the open
 *  of the first session that trades its side, and T+N counts from that fill, so the day it can be
 *  sold moves by the same number of sessions. */
function entryFillOf(input: LockInput, window: SessionWindow): EntryFill {
  const locked = input.suggestion.action === 'buy' ? 'ceiling' : 'floor'
  const offset = window.bars.findIndex(
    (_, index) => limitLockAt(input, window.start + index) !== locked
  )
  const bar = window.bars[offset]

  if (bar === undefined) {
    return { kind: 'shut' }
  }

  const sellableFrom = input.suggestion.settlement?.sellableFrom

  const fill = { offset, session: bar.at, entry: bar.open }

  if (offset === 0 || sellableFrom === undefined) {
    return { kind: 'filled', ...fill }
  }

  const lag = window.bars.filter((session) => session.at < sellableFrom).length
  const settles = window.bars[offset + lag]

  return settles === undefined
    ? { kind: 'unsettled', ...fill }
    : { kind: 'filled', ...fill, sellableFrom: settles.at }
}

/** A resting buy fills on the first session that trades below it - a touch is no fill, as with a
 *  target - and at that session's open where it opened below. Past `until` with no such session the
 *  order is gone; before it, still resting. */
function restingFillOf(
  suggestion: Pick<ActionableSuggestion, 'entry'> & { readonly restingEntry: RestingEntry },
  window: SessionWindow
): EntryFill {
  const { entry, restingEntry } = suggestion
  const offset = window.bars.findIndex(
    (session) => session.at <= restingEntry.until && session.low < entry
  )
  const bar = window.bars[offset]

  if (bar !== undefined) {
    return { kind: 'filled', offset, session: bar.at, entry: Math.min(entry, bar.open) }
  }

  return window.bars.some((session) => session.at >= restingEntry.until)
    ? { kind: 'shut' }
    : { kind: 'resting' }
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
