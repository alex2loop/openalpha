import type { Caveat } from '@/trading/kernel/caveat'
import type { Ticker } from '@/trading/kernel/instrument'
import type { InstrumentRequest } from '@/trading/kernel/market/market-capability'
import type { Quote } from '@/trading/kernel/market/market-data'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { TradingCalendar } from '@/trading/markets/types'
import { lastSettledDay } from '@/trading/markets/bars'
import { isLiveObservation } from '@/trading/markets/calendar'
import { dayChangePct } from '@/trading/sources/rows/normalization'

/** Trading days back to look for the previous session, with slack for a name halted through several. */
const QUOTE_SESSIONS = 10

export type AvailableQuote = SourceResult<Quote> & { readonly kind: 'available' }

interface LiveOrStoredInput {
  readonly deps: MarketDeps
  readonly calendar: TradingCalendar
  readonly request: InstrumentRequest
  readonly quote: SourceResult<Quote>
}

/** What a market answers once its provider has: the reading where it is genuinely the price the
 *  tape is making, the settled close where it is not, and the refusal only where the store cannot
 *  price the name either. A provider answers a halted ticker with its last print indefinitely and a
 *  stalled feed answers with a bar from hours ago, both well-formed — so a market that returned the
 *  refusal alone left every surface unpriced for a close it already holds. */
export async function liveOrStoredQuote(input: LiveOrStoredInput): Promise<SourceResult<Quote>> {
  const { calendar, deps, quote, request } = input

  if (
    quote.kind !== 'available' ||
    isLiveObservation(calendar, quote.value.observedAt, request.now)
  ) {
    return quote
  }

  const stored = await storedQuote(deps, calendar, request)

  // A name the store cannot price leaves the refused reading as the only mark there is, which is
  // the reading a book values on. Nothing is tagged there: the freshness stamp the market-data read
  // computes already labels it a close rather than the price the market is making now, and the
  // caveat would promise a settled close no row is showing.
  return stored === undefined ? quote : withNotLive(stored, request.instrument.ticker)
}

/** The newest settled close the store holds for a name, shaped as the quote a caller asked for. */
export async function storedQuote(
  deps: MarketDeps,
  calendar: TradingCalendar,
  request: InstrumentRequest
): Promise<AvailableQuote | undefined> {
  const toDay = lastSettledDay(request, calendar)
  const rows = await deps.marketDataStore.listBars({
    instrument: request.instrument,
    fromDay: calendar.addTradingDays(toDay, -QUOTE_SESSIONS),
    toDay,
    signal: request.signal,
  })
  const newest = rows[rows.length - 1]

  if (newest === undefined || newest.candle.at < toDay) {
    return undefined
  }

  // A settled bar was observed at its own session's close; `fetchedAt` would date it to the refresh.
  const observedAt = calendar.sessionCloseAt(newest.candle.at)
  const changePct = dayChangePct(newest.candle.close, rows[rows.length - 2]?.candle.close)

  return {
    kind: 'available',
    value: {
      instrument: request.instrument,
      price: newest.candle.close,
      ...(changePct === undefined ? {} : { changePct }),
      observedAt,
    },
    provenance: [
      { sourceId: newest.sourceId, fetchedAt: newest.fetchedAt, freshness: 'cached', observedAt },
    ],
    caveats: [],
  }
}

/** A held name whose board is open but has not printed is not the same fact as a shut market, and
 *  the absent live row cannot say which. Named, because the operator can act on a halted ticker. */
export function withNotLive(stored: AvailableQuote, ticker: Ticker): SourceResult<Quote> {
  const caveat: Caveat = { code: 'market-data.quote-not-live', detail: { ticker } }

  return { ...stored, caveats: [...stored.caveats, caveat] }
}

/** What a holder is paid to sell right now: a dealer board's buy price, the last trade otherwise.
 *  A held position's levels are watched on this side, the side its exit actually fills at. */
export function exitPriceOf(quote: Pick<Quote, 'price' | 'board'>): number {
  return quote.board?.buyPrice ?? quote.price
}
