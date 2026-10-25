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

/** Cuts the nav to the year of `today` (`YYYY-MM-DD`). The index is time-weighted, so the year's
 *  return is its last index over the index at the turn of the year: the last point before 1 January,
 *  or the first point of the year for a record that began in it. */
export function toYearView(nav: TradingNavResponse, today: string): YearView {
  const startDay = `${today.slice(0, YEAR_LENGTH)}-01-01`
  const points = nav.points.filter((point) => point.day >= startDay)
  const benchmark = (nav.benchmark?.points ?? []).filter((point) => point.day >= startDay)
  const book = toBase(nav.points, startDay)
  const target = toBase(nav.benchmark?.points ?? [], startDay)
  const drawdowns = toDrawdowns([...book.before, ...points].map((point) => point.index))

  return {
    points,
    benchmark,
    periodReturn: toReturn(book.base, points.at(-1)),
    benchmarkReturn: toReturn(target.base, benchmark.at(-1)),
    maximumDrawdown: drawdowns.maximum,
    currentDrawdown: drawdowns.current,
  }
}

interface Base<T> {
  /** The point the year's return is measured from. */
  readonly base: T | undefined
  /** The base when it lies before the year, else nothing: it seeds the peak without being drawn. */
  readonly before: readonly T[]
}

function toBase<T extends { readonly day: string }>(
  points: readonly T[],
  startDay: string
): Base<T> {
  const before = points.filter((point) => point.day < startDay).at(-1)
  const base = before ?? points.find((point) => point.day >= startDay)

  return { base, before: before === undefined ? [] : [before] }
}

function toReturn(
  base: { readonly index: number } | undefined,
  last: { readonly index: number } | undefined
): number | undefined {
  return base === undefined || last === undefined || base === last || base.index === 0
    ? undefined
    : last.index / base.index - 1
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
