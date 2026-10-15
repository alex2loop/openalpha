import type { NavPoint, NavSnapshot } from '@/trading/features/portfolio/nav/types'

/** Time-weighted: a deposit or withdrawal moves NAV without being a gain, so it comes out of the
 *  day it lands on. A period that starts at or below zero has no return to chain. */
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
    const step = prior.navBase > 0 ? (snapshot.navBase - flow) / prior.navBase : 1

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
