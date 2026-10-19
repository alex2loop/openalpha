import type { Logger } from '@/core/logging/logger'
import type { MarketDataStore } from '@/trading/features/market-data/store/market-data'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { TypedPrice } from '@/trading/kernel/surface/surface'
import type { Market } from '@/trading/markets/types'
import { ValidationError } from '@/core/errors'
import { MAXIMUM_CLOSURE_DAYS } from '@/trading/features/market-data/resolve'
import { shiftCalendarDay } from '@/trading/markets/calendar'

// The write waits this long for a price to compare against, and is saved unchecked past it.
const MARKET_PRICE_TIMEOUT_MS = 3_000

export interface TypedPriceDeps {
  readonly marketData: Pick<MarketDataService, 'instrumentQuoteConvention' | 'quoteBoard'>
  /** Stored closes: a write never waits on a provider refetching a window. */
  readonly marketDataStore: Pick<MarketDataStore, 'listBars'>
  readonly logger: Logger
}

interface FullPriceRequest {
  readonly instrument: InstrumentRef
  readonly price: number
  readonly signal: AbortSignal
}

interface NearMarketRequest extends FullPriceRequest {
  readonly market: Pick<Market, 'manifest'>
  /** The day the price belongs to: a trade's own day, today for an alert. */
  readonly day: TradingDay
  readonly confirmMultiple: number
}

interface TypedPriceRequest extends NearMarketRequest {
  readonly typedPrice: TypedPrice | undefined
}

/** The market's own price a typed one is measured against, dated by the day it stands for. */
interface MarketPrice {
  readonly price: number
  readonly at: TradingDay
}

/** A typed price too far from the market to write without the operator saying it is meant. */
export class PriceUnconfirmedError extends ValidationError {
  constructor(
    readonly instrument: InstrumentRef,
    readonly price: number,
    readonly latest: MarketPrice
  ) {
    super(
      `${instrument.ticker} at ${price} is far from its latest price of ${latest.price} ` +
        `(${latest.at}); ask the operator to confirm the price, then call again with ` +
        'priceConfirmed true',
      {
        key: 'errors.priceFarFromMarket',
        params: {
          ticker: instrument.ticker,
          price: String(price),
          latest: String(latest.price),
          day: latest.at,
        },
      }
    )
  }
}

/** A price typed as the board figure would book a thousand times off, so it is refused; one typed
 *  far from the market's own price waits for the operator to confirm it. */
export async function assertTypedPrice(
  deps: TypedPriceDeps,
  request: TypedPriceRequest
): Promise<void> {
  await assertFullPrice(deps.marketData, request)

  if (request.typedPrice === 'unconfirmed') {
    await assertNearMarket(deps, request)
  }
}

/** Refuses a price typed as the board figure: below the board scale while the name trades above
 *  it, so the operator meant `price × divisor`. The quote is read only for a price below the scale,
 *  and a name with no quote is let through. A board-scaled market quotes whole currency units, so
 *  the full price is rounded to one. */
async function assertFullPrice(
  marketData: Pick<MarketDataService, 'instrumentQuoteConvention' | 'quoteBoard'>,
  request: FullPriceRequest
): Promise<void> {
  const { instrument, price, signal } = request
  const convention = await marketData.instrumentQuoteConvention({
    ticker: instrument.ticker,
    market: instrument.market,
    signal,
  })
  const divisor = convention?.display?.divisor ?? 1

  if (divisor <= 1 || price >= divisor) {
    return
  }

  const board = await marketData.quoteBoard({ instruments: [instrument], signal })
  const last = board.items[0]?.last

  if (last === undefined || last < divisor) {
    return
  }

  const full = Math.round(price * divisor)

  throw new ValidationError(`price ${price} is below the board scale; meant ${full}?`, {
    key: 'errors.priceBelowBoardScale',
    params: { price: String(price), full: String(full), ticker: instrument.ticker },
  })
}

/** Holds a price `confirmMultiple` times above or below the market's latest price on or before its
 *  day for the operator to confirm. A name with no price to compare is let through: the check
 *  catches a slipped unit, and without a price there is nothing to measure the slip against. */
async function assertNearMarket(deps: TypedPriceDeps, request: NearMarketRequest): Promise<void> {
  const { instrument, price } = request
  const latest = await latestPriceWithin(deps, request)

  if (latest === undefined || latest.price <= 0 || price <= 0) {
    return
  }

  const multiple = Math.max(price / latest.price, latest.price / price)

  if (multiple >= request.confirmMultiple) {
    throw new PriceUnconfirmedError(instrument, price, latest)
  }
}

/** A slow source must not hold the write: past the deadline the price goes unchecked. The
 *  operator's own cancel still cancels. */
async function latestPriceWithin(
  deps: TypedPriceDeps,
  request: NearMarketRequest
): Promise<MarketPrice | undefined> {
  const deadline = AbortSignal.timeout(MARKET_PRICE_TIMEOUT_MS)
  const signal = AbortSignal.any([request.signal, deadline])
  let latest: MarketPrice | undefined

  try {
    latest = await latestPriceOf(deps, { ...request, signal })
  } catch (err: unknown) {
    if (request.signal.aborted || !deadline.aborted) {
      throw err
    }
  }

  if (!deadline.aborted) {
    return latest
  }

  deps.logger.debug('trading.typed_price_unchecked', { ticker: request.instrument.ticker })

  return undefined
}

/** The latest stored close on or before the day, else the price trading now. A market whose bars
 *  are another instrument's tape (VN gold reads world gold in USD) has no close of its own. */
async function latestPriceOf(
  deps: TypedPriceDeps,
  request: NearMarketRequest
): Promise<MarketPrice | undefined> {
  const close =
    request.market.manifest.referenceBarsOnly === true
      ? undefined
      : await storedCloseOf(deps, request)

  return close ?? (await boardPriceOf(deps, request))
}

async function storedCloseOf(
  deps: TypedPriceDeps,
  request: NearMarketRequest
): Promise<MarketPrice | undefined> {
  const bars = await deps.marketDataStore.listBars({
    instrument: request.instrument,
    fromDay: shiftCalendarDay(request.day, -MAXIMUM_CLOSURE_DAYS),
    toDay: request.day,
    signal: request.signal,
  })
  const latest = bars.at(-1)?.candle

  return latest === undefined ? undefined : { price: latest.close, at: latest.at }
}

async function boardPriceOf(
  deps: TypedPriceDeps,
  request: NearMarketRequest
): Promise<MarketPrice | undefined> {
  const board = await deps.marketData.quoteBoard({
    instruments: [request.instrument],
    signal: request.signal,
  })
  const item = board.items[0]

  return item === undefined ? undefined : { price: item.last, at: item.observed.day }
}
