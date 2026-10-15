import type { TradingDay } from '@/trading/kernel/instrument'
import { tradingDay } from '@/trading/kernel/instrument'

const DISCLOSURE_KINDS = Object.freeze([
  'quarterly-report',
  'semi-annual-report',
  'annual-report',
] as const)
export type DisclosureKind = (typeof DISCLOSURE_KINDS)[number]

/** Circular 96/2020/TT-BTC, in calendar days after the period closes. These are deadlines, not
 *  publication dates: a company may file early, and most file close to the limit. The quarter is the
 *  parent company's 30 days rather than a standalone issuer's 20: most listed names file
 *  consolidated accounts, and the date is when a report is due at the latest. */
const DEADLINE_DAYS = Object.freeze({
  'quarterly-report': 30,
  'semi-annual-report': 45,
  'annual-report': 90,
} as const satisfies Readonly<Record<DisclosureKind, number>>)

/** Period ends as `MM-DD`. The half-year and the year close on a quarter end too, so those two
 *  dates carry a second, later deadline rather than replacing the quarterly one. */
const QUARTER_ENDS: readonly string[] = Object.freeze(['03-31', '06-30', '09-30', '12-31'])
const HALF_YEAR_END = '06-30'
const YEAR_END = '12-31'
const DAY_LENGTH = 10
/** Last year, this year, next year. Last year is not optional: a period closing on 31 December has
 *  deadlines up to 90 days into the following year, so the audited annual a reader met in February
 *  belongs to the year before. Three years always contain the next deadline, whatever day `asOf`
 *  falls on. */
const CANDIDATE_YEARS = 3
const FIRST_CANDIDATE_YEAR_OFFSET = -1

interface DisclosureWindow {
  readonly kind: DisclosureKind
  readonly dueBy: TradingDay
}

/** The next statutory publication deadline strictly after `asOf`. Undefined is impossible in
 *  practice and is still returned rather than thrown: a caller that gets one simply has nothing
 *  to say about upcoming reports. */
export function nextDisclosure(asOf: TradingDay): DisclosureWindow | undefined {
  return candidates(asOf)
    .filter((window) => window.dueBy > asOf)
    .toSorted((left, right) => left.dueBy.localeCompare(right.dueBy))[0]
}

/** The statutory deadline for the audited annual report of a fiscal year closing 31 December. */
export function annualReportDeadline(fiscalYear: number): TradingDay {
  return deadline(fiscalYear, YEAR_END, 'annual-report')
}

/** The statutory deadline for the quarterly report of the period closing on `periodEnd`. */
export function quarterlyReportDeadline(periodEnd: TradingDay): TradingDay {
  return deadline(Number(periodEnd.slice(0, 4)), periodEnd.slice(5), 'quarterly-report')
}

function candidates(asOf: TradingDay): readonly DisclosureWindow[] {
  const startYear = Number(asOf.slice(0, 4))

  // A year that will not parse reaches `Date.UTC` as NaN and makes `toISOString` throw. This runs
  // inside a stage, where a throw is a block, so an undatable day answers "nothing upcoming".
  if (!Number.isInteger(startYear)) {
    return []
  }

  return Array.from(
    { length: CANDIDATE_YEARS },
    (_, offset) => startYear + FIRST_CANDIDATE_YEAR_OFFSET + offset
  ).flatMap((year) => yearWindows(year))
}

function yearWindows(year: number): readonly DisclosureWindow[] {
  const quarterly = QUARTER_ENDS.map(
    (end): DisclosureWindow => ({
      kind: 'quarterly-report',
      dueBy: deadline(year, end, 'quarterly-report'),
    })
  )

  return [
    ...quarterly,
    { kind: 'semi-annual-report', dueBy: deadline(year, HALF_YEAR_END, 'semi-annual-report') },
    { kind: 'annual-report', dueBy: deadline(year, YEAR_END, 'annual-report') },
  ]
}

function deadline(year: number, periodEnd: string, kind: DisclosureKind): TradingDay {
  const [month, date] = periodEnd.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, (month ?? 1) - 1, (date ?? 1) + DEADLINE_DAYS[kind]))

  return tradingDay(shifted.toISOString().slice(0, DAY_LENGTH))
}
