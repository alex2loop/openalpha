import type { TradingDay } from '@/trading/kernel/instrument'
import { MS_PER_DAY, utcDay } from '@/core/utils/time'
import { tradingDay } from '@/trading/kernel/instrument'

// Vietnamese lunar calendar after Ho Ngoc Duc's algorithm (xemlich.com): new moons
// and the sun's longitude computed astronomically, month boundaries read at UTC+7, which is what
// puts the Vietnamese calendar a day apart from the Chinese one in some years. Only the lunar to
// solar direction is needed here.

const VIETNAM_UTC_OFFSET_HOURS = 7
const SYNODIC_MONTH_DAYS = 29.530588853
/** Julian day of the new moon that opens lunar cycle 0 (1900-01-01), the algorithm's origin. */
const CYCLE_ORIGIN_JD = 2415021.076998695
const CYCLE_ORIGIN_DAY = 2415021
/** The Julian day number the algorithm gives 1970-01-01. */
const UNIX_EPOCH_JD = 2440588
const DEGREES_TO_RADIANS = Math.PI / 180
const HOURS_PER_DAY = 24
/** The lunar month holding the winter solstice is the eleventh. */
const SOLSTICE_MONTH = 11
const MONTHS_PER_YEAR = 12
const LEAP_YEAR_MIN_DAYS = 365
const MONTH_SEARCH_LIMIT = 14
/** The sun is past this longitude step at the new moon that would open month 11 a month too late. */
const LATE_MONTH_11_STEP = 9

/** The solar day of a lunar date in a given lunar year. A non-leap month only: no closure here
 *  falls in a leap month. */
export function toSolarDay(lunarYear: number, lunarMonth: number, lunarDay: number): TradingDay {
  const [first, next] =
    lunarMonth < SOLSTICE_MONTH
      ? [month11Start(lunarYear - 1), month11Start(lunarYear)]
      : [month11Start(lunarYear), month11Start(lunarYear + 1)]
  const cycle = Math.floor(0.5 + (first - CYCLE_ORIGIN_JD) / SYNODIC_MONTH_DAYS)
  let offset = (lunarMonth - SOLSTICE_MONTH + MONTHS_PER_YEAR) % MONTHS_PER_YEAR

  if (next - first > LEAP_YEAR_MIN_DAYS && offset >= leapMonthOffset(first)) {
    offset += 1
  }

  const jd = moonStartJd(cycle + offset) + lunarDay - 1

  return tradingDay(utcDay((jd - UNIX_EPOCH_JD) * MS_PER_DAY))
}

function julianDay(day: number, month: number, year: number): number {
  const shift = Math.floor((14 - month) / MONTHS_PER_YEAR)
  const y = year + 4800 - shift
  const m = month + MONTHS_PER_YEAR * shift - 3

  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  )
}

/** The Julian day number of the Vietnamese calendar day the `k`th new moon after 1900 falls on. */
function moonStartJd(k: number): number {
  const t = k / 1236.85
  const t2 = t * t
  const t3 = t2 * t
  const rad = DEGREES_TO_RADIANS
  const mean =
    2415020.75933 +
    29.53058868 * k +
    0.0001178 * t2 -
    0.000000155 * t3 +
    0.00033 * Math.sin((166.56 + 132.87 * t - 0.009173 * t2) * rad)
  const sunAnomaly = 359.2242 + 29.10535608 * k - 0.0000333 * t2 - 0.00000347 * t3
  const moonAnomaly = 306.0253 + 385.81691806 * k + 0.0107306 * t2 + 0.00001236 * t3
  const latitude = 21.2964 + 390.67050646 * k - 0.0016528 * t2 - 0.00000239 * t3
  const sin = (degrees: number): number => Math.sin(degrees * rad)
  const correction =
    (0.1734 - 0.000393 * t) * sin(sunAnomaly) +
    0.0021 * sin(2 * sunAnomaly) -
    0.4068 * sin(moonAnomaly) +
    0.0161 * sin(2 * moonAnomaly) -
    0.0004 * sin(3 * moonAnomaly) +
    0.0104 * sin(2 * latitude) -
    0.0051 * sin(sunAnomaly + moonAnomaly) -
    0.0074 * sin(sunAnomaly - moonAnomaly) +
    0.0004 * sin(2 * latitude + sunAnomaly) -
    0.0004 * sin(2 * latitude - sunAnomaly) -
    0.0006 * sin(2 * latitude + moonAnomaly) +
    0.001 * sin(2 * latitude - moonAnomaly) +
    0.0005 * sin(2 * moonAnomaly + sunAnomaly)
  const deltaT =
    t < -11
      ? 0.001 + 0.000839 * t + 0.0002261 * t2 - 0.00000845 * t3 - 0.000000081 * t * t3
      : -0.000278 + 0.000265 * t + 0.000262 * t2

  return Math.floor(mean + correction - deltaT + 0.5 + VIETNAM_UTC_OFFSET_HOURS / HOURS_PER_DAY)
}

/** Which of the twelve 30-degree steps (counted in sixths of a half turn) the sun is in at local midnight of that Julian day. */
function sunLongitudeStep(jd: number): number {
  const t = (jd - 2451545.5 - VIETNAM_UTC_OFFSET_HOURS / HOURS_PER_DAY) / 36525
  const t2 = t * t
  const rad = DEGREES_TO_RADIANS
  const anomaly = 357.5291 + 35999.0503 * t - 0.0001559 * t2 - 0.00000048 * t * t2
  const meanLongitude = 280.46645 + 36000.76983 * t + 0.0003032 * t2
  const center =
    (1.9146 - 0.004817 * t - 0.000014 * t2) * Math.sin(rad * anomaly) +
    (0.019993 - 0.000101 * t) * Math.sin(rad * 2 * anomaly) +
    0.00029 * Math.sin(rad * 3 * anomaly)
  const longitude = (meanLongitude + center) * rad
  const turn = Math.PI * 2

  return Math.floor(((longitude - turn * Math.floor(longitude / turn)) / Math.PI) * 6)
}

/** The Julian day the lunar month 11 of that year opens on: the month holding the winter solstice. */
function month11Start(year: number): number {
  const k = Math.floor((julianDay(31, 12, year) - CYCLE_ORIGIN_DAY) / SYNODIC_MONTH_DAYS)
  const start = moonStartJd(k)

  return sunLongitudeStep(start) >= LATE_MONTH_11_STEP ? moonStartJd(k - 1) : start
}

/** In a 13-month year, how many months after month 11 the leap month sits: the first month with no
 *  solar term, where the sun's step does not advance. */
function leapMonthOffset(month11: number): number {
  const k = Math.floor((month11 - CYCLE_ORIGIN_JD) / SYNODIC_MONTH_DAYS + 0.5)
  let month = 1
  let step = sunLongitudeStep(moonStartJd(k + month))
  let last: number

  do {
    last = step
    month += 1
    step = sunLongitudeStep(moonStartJd(k + month))
  } while (step !== last && month < MONTH_SEARCH_LIMIT)

  return month - 1
}
