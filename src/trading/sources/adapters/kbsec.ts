// Source class: scraping-risky. `kbbuddywts.kbsec.com.vn` is an internal broker endpoint with no
// SLA -- like `vietcap` and `vndirect`, it can change or refuse traffic without notice.
import { z } from 'zod'

import type { DailyTradeSides } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceFetchOutcome, SourceHttp } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { sourceId } from '@/trading/kernel/source/source-id'
import { createSource, parsedSource } from '@/trading/sources/define'
import { parseRow } from '@/trading/sources/rows/normalization'

export const KBSEC_DEFAULT_ENDPOINT = 'https://kbbuddywts.kbsec.com.vn'

const KBSEC_ID = sourceId('kbsec')
const MATCHED_BY_PRICE_PATH = '/iis-server/investment/stock/matched-by-price'
/** Share counts are whole on this board, so anything under one is rounding rather than a lost row. */
const VOLUME_TOLERANCE = 1

const PRICE_LEVEL = z.object({
  buyVol: z.coerce.number().finite().nonnegative(),
  sellVol: z.coerce.number().finite().nonnegative(),
  unknownVol: z.coerce.number().finite().nonnegative(),
  totalVol: z.coerce.number().finite().nonnegative(),
})

type PriceLevel = z.infer<typeof PRICE_LEVEL>

export function createKbsecSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [tradeSidesSource(options)]
}

/** The whole session's split in one read, already aggregated by price level, so there is no
 *  pagination to bound and no partial window to reject. Settled sessions only: a mid-session ratio
 *  samples whatever has traded so far and flips too often to act on.
 *
 *  The board answers with whatever session it currently holds and its payload carries no date, so
 *  `toDay` is a stamp this adapter cannot check — unlike the vietcap leg, whose tick rows date
 *  themselves. Every caller must therefore ask only while `isTapeServing` holds for the day it
 *  wants, or the reply is one session filed under another. */
function tradeSidesSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: KBSEC_ID,
    kind: 'tradeSides',
    http: options.http,
    covers: (context: SourceContext) =>
      context.instrument !== undefined && context.toDay !== undefined,
    load: (context, signal) => loadTradeSides(options.http, context, signal),
  })
}

async function loadTradeSides(
  http: SourceHttp,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<DailyTradeSides>>> {
  const { instrument, toDay } = context

  if (instrument === undefined || toDay === undefined) {
    throw new ValidationError('trade sides request carries no instrument or day')
  }

  const outcome = await http.getJson(
    { sourceId: KBSEC_ID, path: `${MATCHED_BY_PRICE_PATH}/${instrument.ticker}`, signal },
    (raw) => toLevels(raw)
  )

  if (outcome.kind === 'error') {
    return outcome
  }

  if (outcome.value.length === 0) {
    return { kind: 'error', code: 'source.empty-window' }
  }

  const volumes = toVolumes(outcome.value)

  if (volumes === undefined) {
    return { kind: 'error', code: 'source.payload-rejected' }
  }

  return {
    kind: 'ok',
    fetchedAt: outcome.fetchedAt,
    value: parsedSource({
      instrument,
      at: toDay,
      ...volumes,
      sourceId: KBSEC_ID,
      fetchedAt: outcome.fetchedAt,
    }),
  }
}

/** A malformed level costs the whole read: the totals are checked against each other, and a
 *  silently dropped level would fail that check anyway. */
function toLevels(raw: unknown): readonly PriceLevel[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError('kbsec matched-by-price payload is not an array')
  }

  return raw.map((row) => parseRow(PRICE_LEVEL, row, 'kbsec price level'))
}

interface Volumes {
  readonly buyVolume: number
  readonly sellVolume: number
  readonly auctionVolume: number
}

/** Absent when the parts disagree with the total the provider states beside them, which means a
 *  side was dropped - a ratio leaning toward whatever survived rather than a missing one. */
function toVolumes(levels: readonly PriceLevel[]): Volumes | undefined {
  const buyVolume = sumBy(levels, (level) => level.buyVol)
  const sellVolume = sumBy(levels, (level) => level.sellVol)
  const auctionVolume = sumBy(levels, (level) => level.unknownVol)
  const stated = sumBy(levels, (level) => level.totalVol)

  if (Math.abs(buyVolume + sellVolume + auctionVolume - stated) > VOLUME_TOLERANCE) {
    return undefined
  }

  return { buyVolume, sellVolume, auctionVolume }
}

function sumBy(levels: readonly PriceLevel[], pick: (level: PriceLevel) => number): number {
  return levels.reduce((sum, level) => sum + pick(level), 0)
}
