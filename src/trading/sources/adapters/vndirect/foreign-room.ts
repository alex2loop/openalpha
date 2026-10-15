import { z } from 'zod'

import type { ForeignRoom } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { RowTarget } from '@/trading/sources/rows/row-target'
import type { SourceFetchOutcome, SourceRequest } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { ticker } from '@/trading/kernel/instrument'
import {
  MARKET_PAGE_SIZE,
  marketSort,
  VNDIRECT_ID,
} from '@/trading/sources/adapters/vndirect/client'
import { readMarketWindow } from '@/trading/sources/adapters/vndirect/market-read'
import { createSource, parsedSource } from '@/trading/sources/define'
import { dropInvalid, nonNegative, parseRow } from '@/trading/sources/rows/normalization'
import { resolveRowTarget } from '@/trading/sources/rows/row-target'

// The endpoint serves every listed thing on both boards - bonds, covered warrants, index
// aggregates - and only tradeable instruments carry room counters, so the query names the types it
// wants. Doing so is cheaper than the unfiltered HOSE sweep it replaces, not merely wider.
const ROOM_ROW = z.object({
  code: z.string().min(1),
  tradingDate: z.string().min(1),
  totalRoom: z.number().optional(),
  currentRoom: z.number().optional(),
})

interface DatedRoom {
  readonly day: string
  readonly room: ForeignRoom
}

/** The whole market's foreign room over a window. Rows come per ticker per day, so the newest day
 *  seen for a code is its latest; `fromDay` is how far back "latest" may look, which the caller
 *  sizes to span market holidays. Read through `readMarketWindow`: the window is past one page and
 *  the provider's offset paging repeats and drops rows. */
export function foreignRoomSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VNDIRECT_ID,
    kind: 'foreignRoom',
    http: options.http,
    covers: (context) => context.fromDay !== undefined && context.toDay !== undefined,
    load: (context, signal) => loadRooms(options, context, signal),
  })
}

async function loadRooms(
  options: SourceAdapterOptions,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<readonly ForeignRoom[]>>> {
  const { fromDay, toDay } = context

  if (fromDay === undefined || toDay === undefined) {
    return { kind: 'error', code: 'source.symbol-not-found' }
  }

  const rows = await readMarketWindow({
    http: options.http,
    window: { fromDay, toDay },
    pageSize: MARKET_PAGE_SIZE,
    request: (window) => roomRequest(window, signal),
  })

  return rows.kind === 'error'
    ? rows
    : { ...rows, value: toForeignRooms(rows.value, resolveRowTarget(context, rows.fetchedAt)) }
}

function roomRequest(
  window: { readonly fromDay: string; readonly toDay: string },
  signal: AbortSignal
): SourceRequest {
  return {
    sourceId: VNDIRECT_ID,
    path: '/v4/foreigns',
    query: {
      q:
        `type:STOCK,ETF~floor:HOSE,HNX~tradingDate:gte:${window.fromDay}` +
        `~tradingDate:lte:${window.toDay}`,
      sort: marketSort('tradingDate', 'asc'),
      size: String(MARKET_PAGE_SIZE),
    },
    signal,
  }
}

function toForeignRooms(
  rows: readonly unknown[],
  target: RowTarget
): ParsedSource<readonly ForeignRoom[]> {
  const latest = new Map<string, DatedRoom>()

  for (const dated of dropInvalid(rows, (row) => toRoom(row, target))) {
    const held = latest.get(dated.room.instrument.ticker)

    if (held === undefined || dated.day > held.day) {
      latest.set(dated.room.instrument.ticker, dated)
    }
  }

  return parsedSource([...latest.values()].map((dated) => dated.room))
}

function toRoom(raw: unknown, target: RowTarget): DatedRoom {
  const row = parseRow(ROOM_ROW, raw, 'vndirect foreign room')

  // Aggregate rows are an expected shape, dropped here rather than rejecting the page.
  if (row.totalRoom === undefined || row.currentRoom === undefined) {
    throw new ValidationError(`row for ${row.code} carries no room`)
  }

  const total = nonNegative(row.totalRoom, 'totalRoom')
  const available = nonNegative(row.currentRoom, 'currentRoom')

  if (available > total) {
    throw new ValidationError(`room for ${row.code} exceeds its total`)
  }

  return {
    day: row.tradingDate,
    room: {
      instrument: { market: target.market, ticker: ticker(row.code) },
      totalRoomShares: total,
      availableRoomShares: available,
    },
  }
}
