// Source class: free and keyless. The Fear & Greed index is one number for the
// whole crypto market, which is why this adapter is market-scoped and never instrument-scoped.
import { z } from 'zod'

import type { MarketRef } from '@/trading/kernel/instrument'
import type { SentimentSnapshot } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceFetchOutcome, SourceRequest } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { sourceId } from '@/trading/kernel/source/source-id'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  dayFromEpochSeconds,
  finite,
  untrustedText,
  utcDayEndEpochMs,
} from '@/trading/sources/rows/normalization'

const ALTERNATIVE_ME_ID = sourceId('alternative-me')

export const ALTERNATIVE_ME_DEFAULT_ENDPOINT = 'https://api.alternative.me'

/** The index is published on a 0-100 scale; consumers normalize, this adapter does not rescale. */
const MINIMUM_INDEX_VALUE = 0
const MAXIMUM_INDEX_VALUE = 100

const FEAR_AND_GREED = z.object({
  data: z.array(
    z.object({
      value: z.string().min(1),
      value_classification: z.string().min(1),
      timestamp: z.string().min(1),
    })
  ),
})

type FearAndGreedRow = z.infer<typeof FEAR_AND_GREED>['data'][number]

export function createAlternativeMeSources(
  options: SourceAdapterOptions
): readonly RegisteredSource[] {
  return [sentimentSource(options)]
}

function sentimentSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: ALTERNATIVE_ME_ID,
    kind: 'sentiment',
    http: options.http,
    covers: (context: SourceContext) => context.market !== undefined,
    load: (context, signal) => loadSentiment(options, context, signal),
  })
}

async function loadSentiment(
  options: SourceAdapterOptions,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<SentimentSnapshot>>> {
  const { market } = context

  // Narrowed rather than asserted: a throw inside the parser would report a stamp this source
  // cannot fill as provider drift.
  if (market === undefined) {
    return { kind: 'error', code: 'source.unavailable' }
  }

  const outcome = await options.http.getJson(
    sentimentRequest(context, signal),
    (raw, fetchedAt) => {
      const rows = FEAR_AND_GREED.parse(raw).data
      const row = sentimentRow(rows, context)

      return row
        ? { kind: 'found' as const, value: toSentiment(row, market, fetchedAt) }
        : { kind: 'missing' as const }
    }
  )

  if (outcome.kind === 'error' || outcome.value.kind === 'missing') {
    return outcome.kind === 'error' ? outcome : { kind: 'error', code: 'source.unavailable' }
  }

  return { ...outcome, value: outcome.value.value }
}

function sentimentRequest(context: SourceContext, signal: AbortSignal): SourceRequest {
  return {
    sourceId: ALTERNATIVE_ME_ID,
    path: '/fng/',
    query: { limit: context.toDay ? '0' : '1' },
    signal,
  }
}

function sentimentRow(
  rows: readonly FearAndGreedRow[],
  context: SourceContext
): FearAndGreedRow | undefined {
  if (!context.toDay) {
    return rows[0]
  }

  const maximumSeconds = utcDayEndEpochMs(context.toDay) / 1_000
  let selected: FearAndGreedRow | undefined
  let selectedSeconds = Number.NEGATIVE_INFINITY

  for (const row of rows) {
    const seconds = Number(row.timestamp)

    if (Number.isFinite(seconds) && seconds <= maximumSeconds && seconds > selectedSeconds) {
      selected = row
      selectedSeconds = seconds
    }
  }

  return selected
}

function toSentiment(
  row: FearAndGreedRow,
  market: MarketRef,
  fetchedAt: number
): ParsedSource<SentimentSnapshot> {
  const score = finite(Number(row.value), 'value')

  if (score < MINIMUM_INDEX_VALUE || score > MAXIMUM_INDEX_VALUE) {
    throw new ValidationError('fear and greed value is outside its published scale')
  }

  const classification = untrustedText(row.value_classification, 'value_classification')

  return parsedSource(
    {
      market,
      asOf: dayFromEpochSeconds(Number(row.timestamp), 'UTC'),
      score,
      classification: classification.value,
      sourceId: ALTERNATIVE_ME_ID,
      fetchedAt,
    },
    classification.caveats
  )
}
