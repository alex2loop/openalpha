import type { NavPoint, NavSnapshot } from '@/trading/features/portfolio/nav/types'

/** Time-weighted: a deposit or withdrawal moves NAV without being a gain. A deposit works from the
 *  start of its day and a withdrawal leaves at its end, so the day's step never turns negative and a
 *  large deposit is not read as a return on the smaller book before it. A day that starts with
 *  nothing invested holds the index. */
export function toNavIndex(snapshots: readonly NavSnapshot[]): readonly NavPoint[] {
  const points: NavPoint[] = []

  for (const [position, snapshot] of snapshots.entries()) {
    const previous = points.at(-1)
    const prior = snapshots[position - 1]

    if (previous === undefined || prior === undefined) {
      points.push({ day: snapshot.day, navBase: snapshot.navBase, index: 1 })
      continue
    }

    const flow = snapshot.netDepositsBase - prior.netDepositsBase
    const invested = prior.navBase + Math.max(flow, 0)
    // A book emptied by a loss can fold to float dust just under zero; it ended at nothing.
    const ended = Math.max(snapshot.navBase - Math.min(flow, 0), 0)
    const step = invested > 0 ? ended / invested : 1

    points.push({ day: snapshot.day, navBase: snapshot.navBase, index: previous.index * step })
  }

  return points
}

export function toDrawdowns(indexes: readonly number[]): {
  readonly maximum: number
  readonly current: number
} {
  let peak = 0
  let maximum = 0

  for (const value of indexes) {
    peak = Math.max(peak, value)
    maximum = Math.max(maximum, peak > 0 ? 1 - value / peak : 0)
  }

  const last = indexes.at(-1) ?? 0

  return { maximum, current: peak > 0 ? 1 - last / peak : 0 }
}

export function toPeriodReturn(indexes: readonly number[]): number | undefined {
  const first = indexes[0]
  const last = indexes.at(-1)

  return first === undefined || last === undefined || indexes.length < 2
    ? undefined
    : last / first - 1
}
