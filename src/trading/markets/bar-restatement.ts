import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { BarRecord } from '@/trading/kernel/market/market-data'
import type { RestatedTarget, SeriesRebase } from '@/trading/kernel/market/refresh'
import type { TargetOutcome } from '@/trading/markets/refresh-result'

/** How far a price may sit from the same session's before the series counts as restated. Wide
 *  enough to absorb a provider's own rounding, far under any corporate action's step. */
export const RESTATEMENT_TOLERANCE = 0.001

/** How much of an already-stored window a refresh re-asks for. A restatement is invisible to a pass
 *  that only fetches days it does not hold, and one session of overlap would miss an action
 *  announced over a weekend. */
export const RESTATEMENT_TAIL_SESSIONS = 20

interface SessionRatio {
  readonly day: TradingDay
  readonly ratio: number
}

/** The names a fetch brought back under different closes than the ones stored, each with its factor
 *  when the change is one re-basing. */
export function restatedTargetsOf(
  closes: ReadonlyMap<Ticker, ReadonlyMap<TradingDay, number>>,
  outcomes: readonly TargetOutcome<readonly BarRecord[]>[],
  tolerance?: number
): readonly RestatedTarget[] {
  return outcomes.flatMap((outcome): readonly RestatedTarget[] => {
    const restatement = restatementOf(
      closes.get(outcome.instrument.ticker),
      outcome.value,
      tolerance
    )

    return restatement === undefined ? [] : [{ target: outcome.instrument.ticker, ...restatement }]
  })
}

/** Any day the provider now publishes under a different close than the one stored, so the whole
 *  window is refetched for that name. Every overlapping session is checked, not the newest alone: a
 *  provider re-basing a name after its ex-date changes only the sessions before it. A day held on
 *  one side only is a name that did not trade or one fetched for the first time - neither is
 *  evidence of a restatement.
 *
 *  `undefined` is a series that was not restated. A restatement carries a `rebase` only when it is
 *  one factor over every changed session and nothing after them (a dividend or a split, which move
 *  the sessions before the ex-date together); any other shape, such as a data fix or a changed
 *  session after an unchanged one, is `{}`: restated, with no factor a call could take. */
function restatementOf(
  stored: ReadonlyMap<TradingDay, number> | undefined,
  records: readonly BarRecord[] | undefined,
  tolerance: number = RESTATEMENT_TOLERANCE
): { readonly rebase?: SeriesRebase } | undefined {
  const pairs = ratiosAgainst(stored, records)
  const isChanged = (pair: SessionRatio): boolean => Math.abs(pair.ratio - 1) > tolerance
  const changed = pairs.filter(isChanged)
  const last = changed.at(-1)

  if (last === undefined) {
    return undefined
  }

  const firstUnchanged = pairs.findIndex((pair) => !isChanged(pair))
  const isLeading = firstUnchanged === -1 || firstUnchanged === changed.length
  const isUniform = changed.every(
    (pair) => Math.abs(pair.ratio - last.ratio) / last.ratio <= tolerance
  )

  return isLeading && isUniform ? { rebase: { factor: last.ratio, through: last.day } } : {}
}

/** Each fetched session that has a stored close, oldest first, as new over stored. */
function ratiosAgainst(
  stored: ReadonlyMap<TradingDay, number> | undefined,
  records: readonly BarRecord[] | undefined
): readonly SessionRatio[] {
  const pairs = (records ?? []).flatMap((record) => {
    const close = stored?.get(record.candle.at)

    return close === undefined
      ? []
      : [{ day: record.candle.at, ratio: record.candle.close / close }]
  })

  return pairs.sort((a, b) => a.day.localeCompare(b.day))
}
