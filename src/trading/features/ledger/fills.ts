import type { Logger } from '@/core/logging/logger'
import type { TradeTxnDraft, TradeTxnDraftInput } from '@/trading/features/ledger/types'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { OrderReceipt, OrderSide } from '@/trading/kernel/venue/spot-adapter'
import type { MarketRegistry, TradingCalendar } from '@/trading/markets/types'
import type { VenueRegistry } from '@/trading/venues/types'
import { MS_PER_DAY, parseIsoDay } from '@/core/utils/time'
import { isBookableFill, toBookedFill } from '@/trading/kernel/venue/fee'
import { shiftCalendarDay } from '@/trading/markets/calendar'

/** How far the venue's filled size may sit from the one stated before the two are different trades.
 *  Wide enough to cover a fee shaved off the credited amount, narrow enough that a second buy of a
 *  similar size on the same day never matches. */
/** How far a reported fill's size may sit from a stated one before the two are different
 *  trades. A fee shaved off the credited amount moves the figure; a second trade of a similar
 *  size does not match. */
export const QUANTITY_TOLERANCE = 0.01

/** The whole tolerance for a calendar disagreement. A market's session and the clock the operator
 *  read the trade off differ by a day at most — a crypto fill before 07:00 in UTC+7 belongs to the
 *  previous UTC session — and never by two. */
const DAY_OFFSETS = Object.freeze([-1, 1] as const)

/** The days either side of one. Exported because the sync path asks the same question of a stored
 *  row that this one asks of a reported fill, and two spellings of one day rule would drift. */
export function adjacentDays(day: TradingDay): readonly TradingDay[] {
  return DAY_OFFSETS.map((offset) => shiftCalendarDay(day, offset))
}

interface VenueFillInput {
  readonly markets: MarketRegistry
  readonly venues: VenueRegistry
  readonly draft: TradeTxnDraftInput
  readonly logger: Logger
  readonly signal: AbortSignal
}

/** The row as the exchange filled it, when the exchange can name exactly one fill answering the
 *  trade the operator described. Undefined everywhere else — a venue with no client, one that
 *  cannot enumerate fills, a rights issue no exchange booked, a day outside the venue's history
 *  window, two fills either could be, or a fee the convention cannot book — because a guessed
 *  figure would store one trade under another's. */
export async function resolveVenueFill(input: VenueFillInput): Promise<TradeTxnDraft | undefined> {
  const { draft } = input
  const side = orderSideOf(draft)
  const calendar = input.markets.find(draft.instrument.market)?.manifest.calendar
  const adapter = input.venues.find(draft.venue)?.adapter
  const dayStartUtc = parseIsoDay(draft.at)

  if (
    side === undefined ||
    calendar === undefined ||
    dayStartUtc === undefined ||
    adapter === undefined ||
    adapter.fetchFilledOrders === undefined
  ) {
    return undefined
  }

  const filled = await adapter.fetchFilledOrders({
    symbol: adapter.toSymbol(draft.instrument),
    side,
    // A whole day early, which is ahead of local midnight in every zone: the market's own day has
    // edges this cannot know, so the fetch over-reaches and the filter below decides.
    since: dayStartUtc - MS_PER_DAY,
    signal: input.signal,
  })
  const matches = matchingFills(filled, draft, calendar)
  const [only, second] = matches

  // The evidence gap the operator cannot see from the row alone: the venue answered, and what it
  // answered names either no trade or two the row could equally be.
  if (only === undefined || second !== undefined) {
    input.logger.warn('ledger.venue_fill_unmatched', {
      venue: draft.venue,
      ticker: draft.instrument.ticker,
      matches: matches.length,
    })

    return undefined
  }

  const booked = await toBookedFill({
    receipt: only,
    side,
    baseAsset: draft.instrument.ticker,
    quoteAsset: adapter.quoteAsset,
    priceOf: (asset, signal) => adapter.fetchAssetPrice(asset, signal),
    signal: input.signal,
  })

  if (booked === undefined) {
    return undefined
  }

  // The venue's day, like its quantity and price: which session a fill belongs to is a fact of
  // execution the operator cannot hold, since the exchange renders the trade in their zone and the
  // market's own calendar is the one the row is booked against.
  const at = only.filledAt === undefined ? draft.at : calendar.dayAt(only.filledAt)

  return { ...draft, at, quantity: booked.quantity, unitPrice: only.averagePrice, fee: booked.fee }
}

/** The stated day first, and the neighbours only where it matched nothing. Searching all three at
 *  once would make two trades of one size on consecutive days each match both and refuse the pair,
 *  which is the ordinary shape of averaging in. */
function matchingFills(
  filled: readonly OrderReceipt[],
  draft: TradeTxnDraftInput,
  calendar: TradingCalendar
): readonly OrderReceipt[] {
  const stated = filled.filter((order) =>
    isFillForDraft(order, { draft, calendar, days: [draft.at] })
  )

  if (stated.length > 0) {
    return stated
  }

  const nearby = { draft, calendar, days: adjacentDays(draft.at) }

  return filled.filter((order) => isFillForDraft(order, nearby))
}

/** What a reported fill is held against: the row as stated, the calendar that names a fill's day,
 *  and the days that day may be. */
interface FillMatch {
  readonly draft: TradeTxnDraftInput
  readonly calendar: TradingCalendar
  readonly days: readonly TradingDay[]
}

/** A rights issue is an allotment the exchange never booked as an order, so it has no side to ask
 *  about and nothing to match against. */
function orderSideOf(draft: TradeTxnDraftInput): OrderSide | undefined {
  if (draft.kind === 'buy' || draft.kind === 'sell') {
    return draft.kind
  }

  return undefined
}

/** The market's calendar names the fill's day, so a VN trade is matched against the ICT session
 *  rather than a UTC window seven hours out of step with it. A fill the venue left undated, or one
 *  the order path would refuse to book, is no evidence at all: taking it would zero the row's
 *  basis. */
function isFillForDraft(order: OrderReceipt, match: FillMatch): boolean {
  const { draft } = match

  if (
    order.filledAt === undefined ||
    !match.days.includes(match.calendar.dayAt(order.filledAt)) ||
    !isBookableFill(order)
  ) {
    return false
  }

  return Math.abs(order.filledQuantity - draft.quantity) <= draft.quantity * QUANTITY_TOLERANCE
}
