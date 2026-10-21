import type { TradingDay } from '@/trading/kernel/instrument'
import type { AccountLines } from '@/trading/kernel/market/annual-accounts'
import { MS_PER_DAY } from '@/core/utils/time'
import { SHARES_CONCEPT } from '@/trading/sources/adapters/sec/concepts'
import { utcDayOf, utcDayStartEpochMs, yearOf } from '@/trading/sources/rows/normalization'

export const FRAME_CONCURRENCY = 4

const FISCAL_YEAR_GRACE_DAYS = 7

/** A frame that does not exist yet (a year not reported) is a business miss, not an outage. */
export const BUSINESS_MISS_STATUSES = Object.freeze([404])

export interface FrameFact {
  readonly cik: string
  readonly end: TradingDay
  readonly value: number
}

export interface FrameJob {
  readonly taxonomy: string
  readonly tag: string
  readonly unit: 'USD' | 'shares'
  readonly period: string
  /** Where the answer lands: a line, and the year an instant frame is filed under. */
  readonly line: keyof AccountLines
  readonly instantYear?: number
  readonly priority: number
}

export interface FrameAnswer {
  readonly job: FrameJob
  readonly facts: readonly FrameFact[]
}

export function sharesJob(year: number): FrameJob {
  return {
    taxonomy: SHARES_CONCEPT.taxonomy,
    tag: SHARES_CONCEPT.tag,
    unit: 'shares',
    period: `CY${year}Q4I`,
    line: 'sharesOutstanding',
    instantYear: year,
    priority: 0,
  }
}

export function usGaapJob(
  concept: { readonly line: keyof AccountLines; readonly tag: string; readonly priority: number },
  period: string
): FrameJob {
  return { taxonomy: 'us-gaap', unit: 'USD', period, ...concept }
}

/** The year a period ending on `end` belongs to. A 52/53-week filer's year can end in the first days
 *  of January (Harris's 2024 ended 2025-01-03), and keyed by the calendar year of that date it
 *  collides with the next year's and leaves a hole behind it. A week back keeps those with the
 *  year they close, and moves no filer whose year ends later in the month. */
export function fiscalYearOf(end: TradingDay): number {
  return yearOf(utcDayOf(utcDayStartEpochMs(end) - FISCAL_YEAR_GRACE_DAYS * MS_PER_DAY))
}
