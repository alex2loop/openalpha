import { z } from 'zod'

import type { InstrumentKind, MarketRef, TradingDay } from '@/trading/kernel/instrument'
import type { ForeignRoom, SessionQuote } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceFetchOutcome, SourceHttp } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { ticker, tradingDay } from '@/trading/kernel/instrument'
import { VIETCAP_BOARD_ID } from '@/trading/sources/adapters/vietcap/client'
import { createSource, mapOutcome, parsedSource } from '@/trading/sources/define'
import {
  dropInvalid,
  fromCodeTable,
  nonNegative,
  PERCENT_PER_UNIT,
} from '@/trading/sources/rows/normalization'
import { resolveRowTarget } from '@/trading/sources/rows/row-target'

const LISTING_PATH = '/api/price/symbols/getAll'
const BOARD_PATH = '/api/price/symbols/getList'

/** Symbols per board request. The reply decodes to roughly 2.4 KB per name, so the whole list at
 *  once lands near 4 MiB - refused unparsed against the transport's 2 MiB ceiling, which every name
 *  then fails over silently. This many keeps a reply near 1.4 MiB whatever the session. */
const BOARD_CHUNK_SIZE = 600

/** This adapter's SLA. The board is reached only after the primary already spent its own deadline,
 *  with the overview waiting, and one read is two requests. A retry would charge the reader twice
 *  for a failure that already happened upstream. */
const BOARD_ATTEMPT_LIMITS = Object.freeze({ maxAttempts: 1 })

/** The listing types worth a board row. A type absent here is a listing this feed carries and the
 *  domain has no kind for, so its rows are dropped rather than counted as shares. */
const LISTING_KINDS: Readonly<Record<string, InstrumentKind>> = Object.freeze({
  STOCK: 'equity',
  ETF: 'etf',
})

/** The host's own spelling of the southern exchange. Everything else it publishes already matches
 *  the market's vocabulary, so only this one needs saying. */
const BOARD_NAMES: Readonly<Record<string, string>> = Object.freeze({ HSX: 'HOSE' })

const LISTING_ROW = z.object({
  symbol: z.string().min(1),
  type: z.string().min(1),
})

// A listing the feed holds only partial state for nulls the field rather than omitting the row, so
// the schema admits what it publishes and the row mappers reject what they cannot price.
const BOARD_ROW = z.object({
  listingInfo: z
    .object({
      symbol: z.string().min(1),
      board: z.string().min(1),
      type: z.string().min(1).nullable(),
      tradingDate: z.string().min(1).nullable(),
    })
    .nullable(),
  matchPrice: z.object({
    matchPrice: z.number().optional(),
    referencePrice: z.number().optional(),
    accumulatedVolume: z.number().optional(),
    currentRoom: z.number().optional(),
    totalRoom: z.number().optional(),
  }),
})

type BoardRow = z.infer<typeof BOARD_ROW>

interface BoardRead {
  readonly http: SourceHttp
  readonly context: SourceContext
  readonly signal: AbortSignal
}

/** One board read per pass, so a market-wide count is a request rather than a fan-out. */
export function boardQuotesSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VIETCAP_BOARD_ID,
    kind: 'sessionQuotes',
    http: options.http,
    covers: (context: SourceContext) =>
      context.instrument === undefined &&
      context.market !== undefined &&
      context.toDay !== undefined,
    load: (context, signal) =>
      loadRows({ http: options.http, context, signal }, (row, market) =>
        toSessionQuote(row, market, context.toDay)
      ),
  })
}

/** The room rides the same board read: `currentRoom` and `totalRoom` are published per name beside
 *  the match, so asking for them separately would fetch the same payload twice. */
export function boardRoomSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VIETCAP_BOARD_ID,
    kind: 'foreignRoom',
    http: options.http,
    covers: (context: SourceContext) => context.fromDay !== undefined,
    load: (context, signal) => loadRows({ http: options.http, context, signal }, toForeignRoom),
  })
}

/** Both kinds read one payload, so the row mapper is the only thing that varies. The fold runs
 *  through `mapOutcome` because it happens after the transport call, where a raw throw would
 *  escape failover instead of becoming a rejected payload. */
async function loadRows<TRow>(
  read: BoardRead,
  toRow: (row: BoardRow, market: MarketRef) => TRow
): Promise<SourceFetchOutcome<ParsedSource<readonly TRow[]>>> {
  const outcome = await loadBoard(read.http, read.signal)

  return mapOutcome(outcome, (rows, fetchedAt) => {
    const { market } = resolveRowTarget(read.context, fetchedAt)

    return parsedSource(dropInvalid(rows, (row) => toRow(row, market)))
  })
}

/** The symbol list and the board state are two endpoints of one provider: `getList` names its
 *  symbols explicitly and the request carries none, so the listing is what supplies them. The
 *  board comes back in chunks because one reply for the whole list exceeds what the transport
 *  will read. */
async function loadBoard(
  http: SourceHttp,
  signal: AbortSignal
): Promise<SourceFetchOutcome<readonly BoardRow[]>> {
  const listing = await http.getJson(
    { sourceId: VIETCAP_BOARD_ID, path: LISTING_PATH, ...BOARD_ATTEMPT_LIMITS, signal },
    toSymbols
  )

  if (listing.kind === 'error') {
    return listing
  }

  if (listing.value.length === 0) {
    return { kind: 'error', code: 'source.empty-window' }
  }

  const rows: BoardRow[] = []
  let fetchedAt = Number.POSITIVE_INFINITY

  for (let start = 0; start < listing.value.length; start += BOARD_CHUNK_SIZE) {
    const outcome = await loadChunk(
      http,
      listing.value.slice(start, start + BOARD_CHUNK_SIZE),
      signal
    )

    if (outcome.kind === 'error') {
      return outcome
    }

    rows.push(...outcome.value)
    fetchedAt = Math.min(fetchedAt, outcome.fetchedAt)
  }

  return { kind: 'ok', fetchedAt, value: rows }
}

function loadChunk(
  http: SourceHttp,
  symbols: readonly string[],
  signal: AbortSignal
): Promise<SourceFetchOutcome<readonly BoardRow[]>> {
  return http.postJson(
    {
      sourceId: VIETCAP_BOARD_ID,
      path: BOARD_PATH,
      jsonBody: { symbols },
      ...BOARD_ATTEMPT_LIMITS,
      signal,
    },
    (raw) => BOARD_ROW.array().parse(raw)
  )
}

function toSymbols(raw: unknown): readonly string[] {
  return LISTING_ROW.array()
    .parse(raw)
    .flatMap((row) => (fromCodeTable(LISTING_KINDS, row.type) === undefined ? [] : [row.symbol]))
}

/** A row the feed holds no state for arrives with a null listing, which is a symbol it declined
 *  rather than a payload that broke. */
function toSessionQuote(
  row: BoardRow,
  market: MarketRef,
  session: TradingDay | undefined
): SessionQuote {
  const listing = row.listingInfo
  const reference = row.matchPrice.referencePrice

  if (listing === null || reference === undefined || reference <= 0) {
    throw new ValidationError('board row has no reference to price against')
  }

  // The board answers with each name's own last session, so a dormant one carries a date months
  // back. Filing that under the day asked for would date a stale close to today.
  if (listing.tradingDate !== session) {
    throw new ValidationError(`board row for ${listing.symbol} is not the session asked for`)
  }

  const kind = listing.type === null ? undefined : fromCodeTable(LISTING_KINDS, listing.type)

  if (kind === undefined) {
    throw new ValidationError(`board row for ${listing.symbol} has no screenable kind`)
  }

  // An unmatched name prints a zero rather than omitting the field, so `??` would read two thirds
  // of the board as a total loss. Before the first match the reference is the price.
  const matched = row.matchPrice.matchPrice
  const close = matched !== undefined && matched > 0 ? matched : reference

  return {
    instrument: { market, ticker: ticker(listing.symbol) },
    at: tradingDay(listing.tradingDate),
    kind,
    board: fromCodeTable(BOARD_NAMES, listing.board) ?? listing.board,
    close,
    changePct: ((close - reference) / reference) * PERCENT_PER_UNIT,
    matchedVolume: nonNegative(row.matchPrice.accumulatedVolume ?? 0, 'accumulatedVolume'),
  }
}

/** A name the feed publishes no room for carries a zero total beside a meaningless negative
 *  current, so the total is what says whether there is a reading at all. */
function toForeignRoom(row: BoardRow, market: MarketRef): ForeignRoom {
  const listing = row.listingInfo
  const { currentRoom, totalRoom } = row.matchPrice

  if (listing === null || totalRoom === undefined || totalRoom <= 0 || currentRoom === undefined) {
    throw new ValidationError('board row carries no room')
  }

  const available = nonNegative(currentRoom, 'currentRoom')

  if (available > totalRoom) {
    throw new ValidationError(`room for ${listing.symbol} exceeds its total`)
  }

  return {
    instrument: { market, ticker: ticker(listing.symbol) },
    totalRoomShares: totalRoom,
    availableRoomShares: available,
  }
}
