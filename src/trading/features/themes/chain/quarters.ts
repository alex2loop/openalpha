import type { EarningsSurprise } from '@/trading/features/themes/types'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { AccountLines, QuarterlyAccounts } from '@/trading/kernel/market/annual-accounts'

const QUARTERS_PER_YEAR = 4
const MONTHS_PER_QUARTER = 3
/** VN companies file a quarter within about 45 days of its end, so two quarters behind the
 *  calendar is ordinary before a filing season; further behind, the name stopped filing or is late
 *  enough that its figures describe another period, and a sector sum would mix it with names a
 *  quarter ahead. */
const MAXIMUM_QUARTERS_BEHIND = 2
/** Earlier year-on-year changes the surprise is measured against: two years of them. */
const SEASONAL_LOOKBACK = 8
const MINIMUM_SEASONAL_CHANGES = 4

export interface TrailingSums {
  readonly latest: number
  readonly prior: number
}

type LineOf = (lines: AccountLines) => number | undefined

interface QuarterRead {
  /** The session the figures are read on; a name filed too long before it is not read. */
  readonly asOf: TradingDay
}

function quarterKey(quarter: Pick<QuarterlyAccounts, 'fiscalYear' | 'quarter'>): number {
  return quarter.fiscalYear * QUARTERS_PER_YEAR + quarter.quarter
}

interface SeasonalTrend {
  readonly mean: number
  readonly spread: number
}

function toLineByKey(
  quarters: readonly QuarterlyAccounts[],
  line: LineOf
): ReadonlyMap<number, number> {
  return new Map(
    quarters.flatMap((quarter): readonly (readonly [number, number])[] => {
      const value = line(quarter.lines)

      return value === undefined ? [] : [[quarterKey(quarter), value]]
    })
  )
}

function quarterKeyOf(day: TradingDay): number {
  const month = Number(day.slice(5, 7))

  return Number(day.slice(0, 4)) * QUARTERS_PER_YEAR + Math.ceil(month / MONTHS_PER_QUARTER)
}

/** Assumes a calendar fiscal year, which nearly every VN listing keeps. */
function newestCurrent(
  quarters: readonly QuarterlyAccounts[],
  read: QuarterRead
): QuarterlyAccounts | undefined {
  const newest = quarters.at(-1)

  return newest === undefined ||
    quarterKey(newest) < quarterKeyOf(read.asOf) - MAXIMUM_QUARTERS_BEHIND
    ? undefined
    : newest
}

/** The newest four quarters and the four before, only when all eight were filed. */
export function toTrailingSums(
  quarters: readonly QuarterlyAccounts[],
  read: QuarterRead & { readonly line: LineOf }
): TrailingSums | undefined {
  const newest = newestCurrent(quarters, read)

  if (newest === undefined) {
    return undefined
  }

  const values = toLineByKey(quarters, read.line)
  const key = quarterKey(newest)
  const window = Array.from({ length: 2 * QUARTERS_PER_YEAR }, (_, offset) =>
    values.get(key - offset)
  )
  const filed = window.flatMap((value) => (value === undefined ? [] : [value]))

  if (filed.length !== window.length) {
    return undefined
  }

  return {
    latest: sumOf(filed.slice(0, QUARTERS_PER_YEAR)),
    prior: sumOf(filed.slice(QUARTERS_PER_YEAR)),
  }
}

/** Standardized unexpected earnings: the newest quarter's change on the same quarter a year
 *  earlier, less the mean of the name's earlier year-on-year changes, over their spread. The
 *  seasonal step keeps a seasonal business from reading as surprising. */
export function toEarningsSurprise(
  quarters: readonly QuarterlyAccounts[],
  read: QuarterRead
): EarningsSurprise | undefined {
  const newest = newestCurrent(quarters, read)

  if (newest === undefined) {
    return undefined
  }

  const profits = toLineByKey(quarters, (lines) => lines.netProfitToParent)
  const key = quarterKey(newest)
  const profit = profits.get(key)
  const yearAgoProfit = profits.get(key - QUARTERS_PER_YEAR)

  if (profit === undefined || yearAgoProfit === undefined) {
    return undefined
  }

  const change = profit - yearAgoProfit
  const trend = seasonalTrend(profits, key)

  return {
    fiscalYear: newest.fiscalYear,
    quarter: newest.quarter,
    publishedOn: newest.publishedOn,
    profit,
    yearAgoProfit,
    ...(trend === undefined || trend.spread === 0
      ? {}
      : { standardized: (change - trend.mean) / trend.spread }),
    ...(yearAgoProfit > 0 ? { growth: change / yearAgoProfit } : {}),
  }
}

function seasonalTrend(
  profits: ReadonlyMap<number, number>,
  key: number
): SeasonalTrend | undefined {
  const changes = Array.from({ length: SEASONAL_LOOKBACK }, (_, offset) => {
    const at = profits.get(key - 1 - offset)
    const yearAgo = profits.get(key - 1 - offset - QUARTERS_PER_YEAR)

    return at === undefined || yearAgo === undefined ? undefined : at - yearAgo
  }).flatMap((change) => (change === undefined ? [] : [change]))

  if (changes.length < MINIMUM_SEASONAL_CHANGES) {
    return undefined
  }

  const mean = sumOf(changes) / changes.length

  return {
    mean,
    spread: Math.sqrt(sumOf(changes.map((change) => (change - mean) ** 2)) / changes.length),
  }
}

function sumOf(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0)
}
