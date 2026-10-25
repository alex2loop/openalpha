import type { TradingNavResponse } from '@/app/server/wire/trading'

// `YYYY`.
const YEAR_LENGTH = 4

type NavPoint = TradingNavResponse['points'][number]

/** The book's record from the first day of a year: its time-weighted index and the target mix over
 *  the same days, with the return and the drops measured inside the year. */
export interface YearView {
  readonly points: readonly NavPoint[]
  readonly benchmark: readonly { readonly day: string; readonly index: number }[]
  readonly periodReturn: number | undefined
  readonly benchmarkReturn: number | undefined
  readonly maximumDrawdown: number
  readonly currentDrawdown: number
}

/** Cuts the nav to the year of `today` (`YYYY-MM-DD`). A record that began this year starts at its
 *  first point; the index is time-weighted, so a year's return is its last index over its first. */
export function toYearView(nav: TradingNavResponse, today: string): YearView {
  const startDay = `${today.slice(0, YEAR_LENGTH)}-01-01`
  const points = nav.points.filter((point) => point.day >= startDay)
  const benchmark = (nav.benchmark?.points ?? []).filter((point) => point.day >= startDay)
  const drawdowns = toDrawdowns(points.map((point) => point.index))

  return {
    points,
    benchmark,
    periodReturn: toReturn(points.map((point) => point.index)),
    benchmarkReturn: toReturn(benchmark.map((point) => point.index)),
    maximumDrawdown: drawdowns.maximum,
    currentDrawdown: drawdowns.current,
  }
}

function toReturn(indexes: readonly number[]): number | undefined {
  const first = indexes[0]
  const last = indexes.at(-1)

  return first === undefined || last === undefined || indexes.length < 2 || first === 0
    ? undefined
    : last / first - 1
}

// How far below the highest index so far the book fell at its worst, and how far it sits now.
function toDrawdowns(indexes: readonly number[]): {
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
