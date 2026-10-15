import { z } from 'zod'

import type { FundamentalSnapshot } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import type { RowTarget } from '@/trading/sources/rows/row-target'
import { ValidationError } from '@/core/errors'
import { ticker, tradingDay } from '@/trading/kernel/instrument'
import { VND, VNDIRECT_ID } from '@/trading/sources/adapters/vndirect/client'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  dropInvalid,
  fromCodeTable,
  PERCENT_PER_UNIT,
  pageRows,
  parseRow,
} from '@/trading/sources/rows/normalization'
import { resolveRowTarget } from '@/trading/sources/rows/row-target'

const RATIO_ROW = z.object({
  code: z.string().min(1),
  reportDate: z.string().min(1),
  ratioCode: z.string().min(1),
  value: z.number(),
})

/** VNDirect returns one row per ratio, so a snapshot is a fold over rows rather than a field map.
 *  The suffixes are the provider's periods: `_TR` trailing twelve months, `_AQ` as of the latest
 *  quarter, `_CR` current, `_AVG4Q` averaged over four quarters, `_GRYOY` year-on-year growth. */
const RATIO_FIELDS = Object.freeze({
  ROAA_TR_AVG4Q: 'returnOnAssetsPct',
  ROAE_TR_AVG4Q: 'returnOnEquityPct',
  GROSS_MARGIN_TR: 'grossMarginPct',
  NET_MARGIN_TR: 'netMarginPct',
  DEBT_TO_EQUITY_AQ: 'debtToEquity',
  NET_SALES_TR_GRYOY: 'revenueGrowthYoyPct',
  NET_PROFIT_TR_GRYOY: 'earningsGrowthYoyPct',
  PRICE_TO_EARNINGS: 'priceToEarnings',
  PRICE_TO_SALES: 'priceToSales',
  BVPS_CR: 'bookValuePerShare',
  MARKETCAP: 'marketCap',
  OUTSTANDING_SHARES: 'sharesOutstanding',
  FREEFLOAT: 'freeFloatPct',
  // `priceToEarnings` is the one code read without being stored: the earnings line is rebuilt from
  // it, and the ratio itself never travels.
} as const satisfies Readonly<Record<string, keyof FundamentalSnapshot | 'priceToEarnings'>>)

type FundamentalRatioField = (typeof RATIO_FIELDS)[keyof typeof RATIO_FIELDS]

/** Every ratio a snapshot is folded from, as the provider names it. */
export const FUNDAMENTAL_RATIO_CODES: readonly string[] = Object.freeze(Object.keys(RATIO_FIELDS))

/** Rows carry three date semantics: a trailing ratio is stamped with its fiscal quarter end, a
 *  share count with the registry date it takes effect on — which is in the future — and a price
 *  ratio with the trading day it was priced at. Only the last describes the snapshot as a whole,
 *  and its day is part of the row's identity, so it is read from these rather than from whichever
 *  row the provider happened to return first or last. */
const PRICED_FIELDS: ReadonlySet<FundamentalRatioField> = new Set([
  'priceToEarnings',
  'priceToSales',
  'bookValuePerShare',
  'marketCap',
])

/** The fields read off a filed statement, whose `reportDate` is the fiscal period end. The others
 *  are dated on different calendars - a priced ratio by its trading day, a share count by the
 *  registry date it takes effect on, which is in the future - so folding them in would date the
 *  accounts by a filing nobody has made yet. */
const FISCAL_FIELDS: ReadonlySet<FundamentalRatioField> = new Set([
  'returnOnAssetsPct',
  'returnOnEquityPct',
  'grossMarginPct',
  'netMarginPct',
  'debtToEquity',
  'revenueGrowthYoyPct',
  'earningsGrowthYoyPct',
])

interface RatioBounds {
  readonly low: number
  readonly high: number
}

/** A free float is a share of outstanding stock, so a value outside [0, 100] is not a measurement.
 *  The provider returns negative ones for names whose overlapping restricted stakes it double-counts
 *  past the share count, and rank normalization cannot rescue a sign error the way it absorbs an
 *  outlier: a negative float would sort below a genuinely illiquid one. */
const RATIO_BOUNDS: Readonly<Partial<Record<FundamentalRatioField, RatioBounds>>> = Object.freeze({
  freeFloatPct: Object.freeze({ low: 0, high: 100 }),
})

/** The provider states these as fractions; every `*Pct` field on a snapshot is a percentage, which
 *  is the scale `qualityScore` averages against a leverage ratio. */
const FRACTION_RATIO_FIELDS: ReadonlySet<FundamentalRatioField> = new Set([
  'returnOnAssetsPct',
  'returnOnEquityPct',
  'grossMarginPct',
  'netMarginPct',
  'revenueGrowthYoyPct',
  'earningsGrowthYoyPct',
  'freeFloatPct',
])

export function fundamentalsSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VNDIRECT_ID,
    kind: 'fundamentals',
    format: 'json',
    http: options.http,
    covers: (context) => requestCodes(context).length > 0,
    request: (context) => {
      const codes = requestCodes(context)

      return codes.length === 0
        ? null
        : {
            path: '/v4/ratios/latest',
            query: {
              filter: `ratioCode:${FUNDAMENTAL_RATIO_CODES.join(',')}`,
              where: `code:${codes.join(',')}`,
              // Required: omitting it answers 404, any other key returns the oldest report.
              order: 'reportDate',
            },
          }
    },
    parse: (raw, context, fetchedAt) =>
      parsedSource(toFundamentals(pageRows(raw), resolveRowTarget(context, fetchedAt))),
  })
}

/** The endpoint has no market-wide form but takes a comma-separated code list, so one request
 *  answers a batch of names and the ticker comes from the row rather than the request. */
function requestCodes(context: SourceContext): readonly string[] {
  return context.tickers ?? (context.instrument === undefined ? [] : [context.instrument.ticker])
}

interface CodeGroup {
  readonly code: string
  /** Absent until a priced row arrives; a response carrying none leaves the snapshot undated and it
   *  is dropped rather than stamped with a quarter end that would collide with the next quarter's. */
  pricedAt?: string
  /** Newest fiscal period end across the statement-derived rows. Absent where none arrived, which
   *  is what a name reporting only a share count leaves behind. */
  reportedOn?: string
  readonly values: Partial<Record<FundamentalRatioField, number>>
}

/** Whether a ratio is dated by the trading day it was priced at rather than by a filing. */
export function isPricedRatio(ratioCode: string): boolean {
  const field = fieldFor(ratioCode)

  return field !== undefined && PRICED_FIELDS.has(field)
}

/** One row per ratio per code, so a batch is folded per code. The whole response being empty is a
 *  provider failure; a code the batch asked for and did not get back is the caller's to report. */
export function toFundamentals(
  rows: readonly unknown[],
  target: RowTarget
): readonly FundamentalSnapshot[] {
  const parsed = dropInvalid(rows, (raw) => parseRow(RATIO_ROW, raw, 'vndirect ratio'))

  if (parsed.length === 0) {
    throw new ValidationError('vndirect ratios returned no rows')
  }

  const groups = new Map<string, CodeGroup>()

  for (const row of parsed) {
    const group = groups.get(row.code) ?? { code: row.code, values: {} }

    groups.set(row.code, group)

    // Skipped, not rejected: the endpoint carries hundreds and this table is a deliberate subset.
    const field = fieldFor(row.ratioCode)

    if (field === undefined) {
      continue
    }

    const value = ratioValue(field, row.value)

    if (value === undefined) {
      continue
    }

    group.values[field] = value

    if (PRICED_FIELDS.has(field)) {
      group.pricedAt = newerDate(group.pricedAt, row.reportDate)
    }

    if (FISCAL_FIELDS.has(field)) {
      group.reportedOn = newerDate(group.reportedOn, row.reportDate)
    }
  }

  return [...groups.values()].flatMap((group) =>
    group.pricedAt === undefined ? [] : [toSnapshot(group, group.pricedAt, target)]
  )
}

function toSnapshot(group: CodeGroup, pricedAt: string, target: RowTarget): FundamentalSnapshot {
  const { priceToEarnings, ...values } = group.values
  const earningsPerShare = toEarningsPerShare(group.values)
  const { reportedOn } = group

  return {
    instrument: { market: target.market, ticker: ticker(group.code) },
    asOf: tradingDay(pricedAt),
    currency: VND,
    ...values,
    ...(earningsPerShare === undefined ? {} : { earningsPerShare }),
    ...(reportedOn === undefined ? {} : { reportedOn: tradingDay(reportedOn) }),
    sourceId: VNDIRECT_ID,
    fetchedAt: target.fetchedAt,
  }
}

/** `EPS_TR` divides the trailing year's profit by that year's share count, while every other ratio
 *  here is priced off the registry count — which takes effect on its own date, after an issue or a
 *  stock dividend. Taken as filed it prices a new share against earnings per old one: MBB read a
 *  P/E of 5,4 against the 6,2 the same payload publishes, and 66 of 652 names were cheap by up to a
 *  fifth. The ratio is on the count its siblings use, so the per-share line is rebuilt from it. */
function toEarningsPerShare(values: CodeGroup['values']): number | undefined {
  const { priceToEarnings, marketCap, sharesOutstanding } = values

  if (priceToEarnings === undefined || priceToEarnings <= 0) {
    return undefined
  }

  if (marketCap === undefined || sharesOutstanding === undefined || sharesOutstanding <= 0) {
    return undefined
  }

  return marketCap / sharesOutstanding / priceToEarnings
}

function fieldFor(ratioCode: string): FundamentalRatioField | undefined {
  return fromCodeTable(RATIO_FIELDS, ratioCode)
}

/** Conversion and plausibility together. Dropping the field rather than the row keeps every ratio
 *  that parsed beside it, and an absent field abstains downstream the way a missing one does. */
function ratioValue(field: FundamentalRatioField, raw: number): number | undefined {
  if (!Number.isFinite(raw)) {
    return undefined
  }

  const value = FRACTION_RATIO_FIELDS.has(field) ? raw * PERCENT_PER_UNIT : raw
  const bounds = RATIO_BOUNDS[field]

  return bounds === undefined || (value >= bounds.low && value <= bounds.high) ? value : undefined
}

/** Newest wins: the provider returns several periods per code, and a snapshot describes the most
 *  recent of them. */
function newerDate(current: string | undefined, candidate: string): string {
  return current === undefined || candidate > current ? candidate : current
}
