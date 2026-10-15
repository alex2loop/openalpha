import { z } from 'zod'

import type { Caveat } from '@/trading/kernel/caveat'
import type { FundingSnapshot } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceFetchOutcome, SourceRequest } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { MS_PER_DAY } from '@/core/utils/time'
import { sourcedCaveat } from '@/trading/kernel/caveat'
import { BINANCE_FUTURES_ID, SYMBOL_MISS_STATUSES } from '@/trading/sources/adapters/binance/client'
import { futuresSymbol } from '@/trading/sources/adapters/binance/symbol'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  finite,
  PERCENT_PER_UNIT,
  utcDayEndEpochMs,
  utcDayOf,
} from '@/trading/sources/rows/normalization'

const FUNDING_RATES = z.array(
  z.object({ symbol: z.string().min(1), fundingTime: z.number(), fundingRate: z.string().min(1) })
)

const OPEN_INTEREST_HISTORY = z.array(
  z.object({
    symbol: z.string().min(1),
    sumOpenInterest: z.string(),
    sumOpenInterestValue: z.string(),
    timestamp: z.number(),
  })
)

const LONG_SHORT_RATIO = z.array(
  z.object({ symbol: z.string().min(1), longShortRatio: z.string(), timestamp: z.number() })
)

/** Ninety settlements. The span they cover is what the rate is divided by, so this is a print
 *  budget rather than a window: thirty days on an eight-hour contract, about four on an hourly one.
 *  Both are long enough to read crowding, and the span travels with the reading. */
const FUNDING_WINDOW_PRINTS = 90

/** Daily prints: a month of open interest and long/short account ratio, long enough to see a crowding
 *  regime without diluting it in a year of mostly-similar days. */
const OPEN_INTEREST_WINDOW_DAYS = 30
const LONG_SHORT_WINDOW_DAYS = 30
/** Prints between the two counts the change compares: three sessions, the span a rally is judged
 *  against, from the same history the ratio reads. */
const OPEN_INTEREST_CHANGE_DAYS = 3

export function binanceFundingSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: BINANCE_FUTURES_ID,
    kind: 'funding',
    http: options.http,
    covers: (context) => context.instrument !== undefined,
    load: (context, signal) => loadFunding(options, context, signal),
    observedAt: (value) => value.observedAt,
  })
}

async function loadFunding(
  options: SourceAdapterOptions,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<FundingSnapshot>>> {
  const request = fundingRequest(context, signal)

  if (!request) {
    return { kind: 'error', code: 'source.symbol-not-found' }
  }

  const fundingOutcome = await options.http.getJson(request, (raw, fetchedAt) => {
    const rows = FUNDING_RATES.parse(raw)

    return rows.length === 0
      ? { kind: 'missing' as const }
      : { kind: 'found' as const, value: parsedSource(toFundingSnapshot(rows, context, fetchedAt)) }
  })

  if (fundingOutcome.kind === 'error' || fundingOutcome.value.kind === 'missing') {
    return fundingOutcome.kind === 'error'
      ? fundingOutcome
      : { kind: 'error', code: 'source.symbol-not-found' }
  }

  const base = fundingOutcome.value.value
  const oiRequest = openInterestRequest(context, signal)
  const lsRequest = longShortRequest(context, signal)

  if (!(oiRequest && lsRequest)) {
    return { kind: 'error', code: 'source.symbol-not-found' }
  }

  // Folded inside the map callback, not after it: a malformed auxiliary row degrades this leg to
  // plain funding instead of throwing past the SourceResult seam and killing the failover chain.
  const [oi, ls] = await Promise.all([
    options.http.getJson(oiRequest, (raw) => openInterestStats(OPEN_INTEREST_HISTORY.parse(raw))),
    options.http.getJson(lsRequest, (raw) => latestLongShortRatio(LONG_SHORT_RATIO.parse(raw))),
  ])

  const openInterest = oi.kind === 'error' ? undefined : oi.value
  const longShortRatio = ls.kind === 'error' ? undefined : ls.value

  return {
    kind: 'ok',
    value: parsedSource(
      {
        ...base.value,
        ...(openInterest?.usd === undefined ? {} : { openInterestUsd: openInterest.usd }),
        ...(openInterest?.ratio === undefined
          ? {}
          : {
              openInterestRatio: {
                value: openInterest.ratio,
                sessions: OPEN_INTEREST_WINDOW_DAYS,
              },
            }),
        ...(openInterest?.change === undefined
          ? {}
          : {
              openInterestChange: {
                value: openInterest.change,
                sessions: OPEN_INTEREST_CHANGE_DAYS,
              },
            }),
        ...(longShortRatio === undefined ? {} : { longShortRatio }),
      },
      [...base.caveats, ...auxiliaryLegCaveats(oi.kind === 'error', ls.kind === 'error')]
    ),
    fetchedAt: fundingOutcome.fetchedAt,
  }
}

/** A dead open-interest or long/short leg degrades the snapshot to plain funding, but nothing else
 *  marks that: `fundingPercentile` reads `openInterestRatio?.value ?? 1`, which is indistinguishable from
 *  a genuinely healthy ratio. Without a caveat here, a crowding-confirmed factor silently loses its
 *  confirmation. */
function auxiliaryLegCaveats(openInterestFailed: boolean, longShortFailed: boolean): Caveat[] {
  const caveats: Caveat[] = []

  if (openInterestFailed) {
    caveats.push(
      sourcedCaveat('source.unavailable', [BINANCE_FUTURES_ID], {
        leg: 'open-interest',
        sourceKind: 'funding',
      })
    )
  }

  if (longShortFailed) {
    caveats.push(
      sourcedCaveat('source.unavailable', [BINANCE_FUTURES_ID], {
        leg: 'long-short',
        sourceKind: 'funding',
      })
    )
  }

  return caveats
}

function fundingRequest(context: SourceContext, signal: AbortSignal): SourceRequest | null {
  if (!context.instrument) {
    return null
  }

  return {
    sourceId: BINANCE_FUTURES_ID,
    path: '/fapi/v1/fundingRate',
    query: {
      symbol: futuresSymbol(context.instrument.ticker),
      limit: String(FUNDING_WINDOW_PRINTS),
      ...(context.toDay ? { endTime: String(utcDayEndEpochMs(context.toDay)) } : {}),
    },
    businessMissStatuses: SYMBOL_MISS_STATUSES,
    signal,
  }
}

function openInterestRequest(context: SourceContext, signal: AbortSignal): SourceRequest | null {
  if (!context.instrument) {
    return null
  }

  return {
    sourceId: BINANCE_FUTURES_ID,
    path: '/futures/data/openInterestHist',
    query: {
      symbol: futuresSymbol(context.instrument.ticker),
      period: '1d',
      limit: String(OPEN_INTEREST_WINDOW_DAYS),
      ...(context.toDay ? { endTime: String(utcDayEndEpochMs(context.toDay)) } : {}),
    },
    businessMissStatuses: SYMBOL_MISS_STATUSES,
    signal,
  }
}

function longShortRequest(context: SourceContext, signal: AbortSignal): SourceRequest | null {
  if (!context.instrument) {
    return null
  }

  return {
    sourceId: BINANCE_FUTURES_ID,
    path: '/futures/data/globalLongShortAccountRatio',
    query: {
      symbol: futuresSymbol(context.instrument.ticker),
      period: '1d',
      limit: String(LONG_SHORT_WINDOW_DAYS),
      ...(context.toDay ? { endTime: String(utcDayEndEpochMs(context.toDay)) } : {}),
    },
    businessMissStatuses: SYMBOL_MISS_STATUSES,
    signal,
  }
}

/** The dollar notional of open contracts (the size of the bet), the current count as a multiple of
 *  its window mean (a crowding signal: above one means positioning is building), and the count's
 *  change over the last few prints (whether a move is being carried by new positions). */
function openInterestStats(
  rows: readonly z.infer<typeof OPEN_INTEREST_HISTORY>[number][]
): { readonly usd: number; readonly ratio?: number; readonly change?: number } | undefined {
  const lastRow = rows.at(-1)

  if (lastRow === undefined) {
    return undefined
  }

  // The ratio and the change read contract count and the level beside them reads notional, so the
  // two answer different questions on purpose: notional is count × price, and over a window where
  // the price ran 20% it reports an expansion nobody opened. The label names which one it is.
  const values = rows.map((row) => finite(Number(row.sumOpenInterest), 'sumOpenInterest'))
  const last = values.at(-1)
  const earlier = values.at(-1 - OPEN_INTEREST_CHANGE_DAYS)

  if (last === undefined) {
    return undefined
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const ratio = mean === 0 ? undefined : last / mean
  const change = earlier === undefined || earlier <= 0 ? undefined : last / earlier - 1

  return {
    usd: finite(Number(lastRow.sumOpenInterestValue), 'sumOpenInterestValue'),
    ...(ratio === undefined ? {} : { ratio }),
    ...(change === undefined ? {} : { change }),
  }
}

function latestLongShortRatio(
  rows: readonly z.infer<typeof LONG_SHORT_RATIO>[number][]
): number | undefined {
  const last = rows.at(-1)

  return last === undefined ? undefined : finite(Number(last.longShortRatio), 'longShortRatio')
}

/** Rows arrive oldest first. Each print is the rate charged at the end of its own interval, so the
 *  cost over the window is every print after the first, and the span is what separates them.
 *  Dividing by the measured span is what makes a four-hour contract comparable to an eight-hour
 *  one; the raw mean is not, and reads half the true daily cost. */
function toFundingSnapshot(
  rows: readonly z.infer<typeof FUNDING_RATES>[number][],
  context: SourceContext,
  fetchedAt: number
): FundingSnapshot {
  const newest = rows[rows.length - 1]
  const oldest = rows[0]

  if (!(newest && oldest && context.instrument)) {
    throw new ValidationError('binance funding response carries no rate for this instrument')
  }

  const windowDays =
    (finite(newest.fundingTime, 'fundingTime') - finite(oldest.fundingTime, 'fundingTime')) /
    MS_PER_DAY

  if (!(windowDays > 0)) {
    throw new ValidationError('binance funding response spans no time')
  }

  const charged = rows
    .slice(1)
    .reduce((sum, row) => sum + finite(Number(row.fundingRate), 'fundingRate'), 0)

  return {
    instrument: context.instrument,
    asOf: context.toDay ?? utcDayOf(fetchedAt),
    observedAt: finite(newest.fundingTime, 'fundingTime'),
    fundingDailyPct: (charged * PERCENT_PER_UNIT) / windowDays,
    windowDays,
    sourceId: BINANCE_FUTURES_ID,
    fetchedAt,
  }
}
