// Source class: free and keyless. The CFTC publishes the Disaggregated Commitments of Traders report
// through its Socrata open-data API, so positioning is a single JSON pull — no credential, no paging.
import { z } from 'zod'

import type { MarketRef } from '@/trading/kernel/instrument'
import type { PositioningSnapshot } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { LoadedSourceSpec, ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceFetchOutcome, SourceRequest } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { tradingDay } from '@/trading/kernel/instrument'
import { sourceId } from '@/trading/kernel/source/source-id'
import { percentileRank } from '@/trading/markets/timeseries'
import { createSource, parsedSource } from '@/trading/sources/define'

const CFTC_ID = sourceId('cftc')

export const CFTC_DEFAULT_ENDPOINT = 'https://publicreporting.cftc.gov'

/** COMEX gold futures in the disaggregated COT report — the contract the positioning factor reports on. */
const GOLD_FUTURES_CODE = '088691'

/** A trailing year of weekly reports: enough to place today's net long on its own percentile, not a
 *  decade of mostly-similar weeks that would flatten every reading toward the middle. */
const POSITIONING_WINDOW_REPORTS = 60

/** Disaggregated Futures-Only: the managed-money columns this factor reads exist in no other set. */
const COT_DATASET_PATH = '/resource/72hh-3qpy.json'

const COT_ROWS = z.array(
  z.object({
    report_date_as_yyyy_mm_dd: z.string().min(1),
    cftc_contract_market_code: z.string().min(1),
    m_money_positions_long_all: z.string(),
    m_money_positions_short_all: z.string(),
  })
)

export function createCftcSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [positioningSource(options)]
}

function positioningSource(options: SourceAdapterOptions): RegisteredSource {
  const spec: LoadedSourceSpec<'positioning'> = {
    id: CFTC_ID,
    kind: 'positioning',
    http: options.http,
    covers: (context) => context.market !== undefined,
    load: (context, signal) => loadPositioning(options, context, signal),
  }

  return createSource(spec)
}

async function loadPositioning(
  options: SourceAdapterOptions,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<PositioningSnapshot>>> {
  const market = context.market

  if (market === undefined) {
    return { kind: 'error', code: 'source.unavailable' }
  }

  const request = positioningRequest(signal)

  return options.http.getJson(request, (raw, fetchedAt) =>
    parsedSource(toPositioningSnapshot(raw, market, fetchedAt))
  )
}

function positioningRequest(signal: AbortSignal): SourceRequest {
  return {
    sourceId: CFTC_ID,
    path: COT_DATASET_PATH,
    query: {
      cftc_contract_market_code: GOLD_FUTURES_CODE,
      $order: 'report_date_as_yyyy_mm_dd DESC',
      $limit: String(POSITIONING_WINDOW_REPORTS),
    },
    signal,
  }
}

/** Rows arrive newest first. Managed-money net long is the crowded-direction signal the factor reads;
 *  the percentile ranks it within the trailing window. The previous week gives the weekly change. */
function toPositioningSnapshot(
  raw: unknown,
  market: MarketRef,
  fetchedAt: number
): PositioningSnapshot {
  const rows = COT_ROWS.parse(raw)

  if (rows.length === 0) {
    throw new ValidationError('cftc returned no positioning rows')
  }

  const nets = rows.map((row) => {
    const long = Number(row.m_money_positions_long_all)
    const short = Number(row.m_money_positions_short_all)

    if (!(Number.isFinite(long) && Number.isFinite(short))) {
      throw new ValidationError('cftc positioning row carries a non-numeric position')
    }

    return long - short
  })

  const latest = rows[0]
  const previous = rows[1]
  const netLatest = nets[0]
  const netPrevious = nets[1]

  if (latest === undefined || netLatest === undefined) {
    throw new ValidationError('cftc returned no positioning rows')
  }

  const week = tradingDay(latest.report_date_as_yyyy_mm_dd.slice(0, 10))
  const percentile = percentileRank(
    nets.filter((net): net is number => net !== undefined),
    netLatest
  )

  return {
    sourceId: CFTC_ID,
    fetchedAt,
    market,
    week,
    netLongContracts: netLatest,
    ...(previous === undefined || netPrevious === undefined
      ? {}
      : { weekChangeContracts: netLatest - netPrevious }),
    ...(percentile === undefined ? {} : { yearPercentile: percentile / 100 }),
  }
}
