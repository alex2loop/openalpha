import type { Caveat } from '@/trading/kernel/caveat'
import type {
  DailyPriceBand,
  DailyPriceBandPolicy,
  InstrumentKind,
  TickSizePolicy,
  TradingDay,
} from '@/trading/kernel/instrument'
import type { Candle, InstrumentRecord, Quote } from '@/trading/kernel/market/market-data'
import type { MarketDeps } from '@/trading/markets/deps'
import type { VnExchange } from '@/trading/markets/equity-vn/policy'
import type { LimitLock, MarketPriceLimit } from '@/trading/markets/price-limit'
import type { TickSizeRequest, TradingCalendar } from '@/trading/markets/types'
import {
  BANK_FOREIGN_ROOM_FRACTION,
  BANK_SECTOR,
  CEILING_LOCK_PROXIMITY_FRACTION,
  COMPULSORY_TRANSFER_BANK_ROOM_FRACTION,
  COMPULSORY_TRANSFER_BANK_TICKERS,
  DAILY_BAND_BY_EXCHANGE,
  DEFAULT_FOREIGN_ROOM_FRACTION,
  FIRST_DAY_BAND_BY_EXCHANGE,
  FUND_TICK,
  LIMIT_HIT_TOLERANCE_FRACTION,
  MINIMUM_FOREIGN_ROOM_VND,
  PRIMARY_EXCHANGE,
  SHARE_TICK_BY_EXCHANGE,
  VN_EXCHANGES,
} from '@/trading/markets/equity-vn/policy'
import { roundToTick, tickSizeFor } from '@/trading/markets/levels'

/** The one owner of "can this be traded, and at what prices" for VN. No other market and no
 *  surface re-derives a tick, a band, or a room percentage. */
interface TradeabilityInput {
  readonly record: InstrumentRecord
  /** The exchange's reference for today's band — derive it with `resolveBandReference`. */
  readonly reference: number
  readonly asOf: TradingDay
  readonly quote?: Quote
}

export interface Tradeability {
  readonly exchange: VnExchange
  readonly tickSize: TickSizePolicy
  /** The day's limits as the exchange quotes them. One value rather than loose fields, so a caller
   *  that needs an edge takes the resolved one instead of re-deriving it from the reference. */
  readonly dailyBand: DailyPriceBand
  readonly reference: number
  /** At or above this the name counts as locked at its ceiling: what is left below the edge is a
   *  queue rather than a price anyone can buy at. One derivation, read by the screen's settled gate
   *  and by the live re-check that follows it, so the two cannot drift apart. */
  readonly lockPrice: number
  /** The fraction of the company foreigners may hold in total, from instrument data where the
   *  source carries it and the sector default otherwise. */
  readonly foreignRoomPct: number
  /** Whether `foreignRoomPct` came from the instrument's own room row. False means it is this file's
   *  sector fallback, which is a default rather than a reading — and the permissive direction, so a
   *  foreign operator is told rather than quietly cleared. */
  readonly foreignRoomMeasured: boolean
  readonly caveats: readonly Caveat[]
}

export function resolveTradeability(input: TradeabilityInput): Tradeability {
  const listed = toVnExchange(input.record.exchange)
  const exchange = listed ?? PRIMARY_EXCHANGE
  const firstDay = isFirstSession(input.record, input.asOf)
  const band = firstDay ? FIRST_DAY_BAND_BY_EXCHANGE[exchange] : DAILY_BAND_BY_EXCHANGE[exchange]
  const tickSize = tickPolicyFor(input.record.kind, exchange)
  const reference = input.reference
  // The band edges are themselves on the tick grid: an exchange never quotes a ceiling between two
  // ticks, and rounding inward keeps both edges inside the legal range.
  const ceiling = roundToTick(reference * (1 + band.maximumUpPct), tickSize, 'down')

  return {
    exchange,
    tickSize,
    reference,
    dailyBand: {
      floor: roundToTick(reference * (1 - band.maximumDownPct), tickSize, 'up'),
      ceiling,
      policy: band,
    },
    lockPrice: ceiling * (1 - CEILING_LOCK_PROXIMITY_FRACTION),
    foreignRoomPct: foreignRoomOf(input.record),
    foreignRoomMeasured: input.record.foreignOwnershipLimitPct !== undefined,
    caveats: bandCaveats(input.record, firstDay, listed),
  }
}

/** A missing or unrecognized tradeability fact becomes a caveat, never a silent default that reads
 *  as certainty. */
function bandCaveats(
  record: InstrumentRecord,
  firstDay: boolean,
  listed: VnExchange | undefined
): readonly Caveat[] {
  const caveats: Caveat[] = []

  if (firstDay) {
    caveats.push({ code: 'market.first-day-band' })
  }

  if (listed === undefined) {
    caveats.push({ code: 'market.exchange-unknown', detail: { ticker: record.instrument.ticker } })
  }

  return caveats
}

/** The close the exchange prices `asOf`'s band from: the newest session strictly before `asOf`,
 *  never a positional `closes[length - 2]`, which reaches one session too far back whenever the
 *  series has not recorded `asOf` yet. An adjusted row restates an ex-dividend reference downward
 *  exactly as the exchange does. */
export function resolveBandReference(
  candles: readonly Candle[],
  asOf: TradingDay
): number | undefined {
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const candle = candles[index]

    if (candle !== undefined && candle.at < asOf && candle.close > 0) {
      return candle.close
    }
  }

  return undefined
}

type DirectionBlock =
  | { readonly kind: 'allowed' }
  | { readonly kind: 'blocked'; readonly caveat: Caveat }

/** A long entry is blocked at the ceiling and a reduction at the floor: at the band edge there is
 *  no counterparty on the side the action needs, so a suggestion to act there is a suggestion the
 *  operator cannot follow. Hitting a band does not halt the name — it caps the matchable price —
 *  so this is a per-direction block, never a trading status. */
export function resolveDirectionBlock(
  tradeability: Tradeability,
  direction: 'buy' | 'reduce',
  last: number
): DirectionBlock {
  const tick = tickSizeFor(last, tradeability.tickSize)

  if (direction === 'buy' && last >= tradeability.dailyBand.ceiling - tick) {
    return {
      kind: 'blocked',
      caveat: { code: 'market.band-edge-blocked', detail: { edge: 'ceiling' } },
    }
  }

  if (direction === 'reduce' && last <= tradeability.dailyBand.floor + tick) {
    return {
      kind: 'blocked',
      caveat: { code: 'market.band-edge-blocked', detail: { edge: 'floor' } },
    }
  }

  return { kind: 'allowed' }
}

/** The cap less current foreign ownership, valued at the company's capitalisation so the answer is
 *  money an order can be filled from. Room that cannot be measured passes: unmeasured is not the
 *  same claim as exhausted. */
export function hasForeignRoom(
  tradeability: Tradeability,
  heldPct: number | undefined,
  marketCap: number | undefined
): boolean {
  if (heldPct === undefined || marketCap === undefined) {
    return true
  }

  return (tradeability.foreignRoomPct - heldPct) * marketCap >= MINIMUM_FOREIGN_ROOM_VND
}

/** A source stamps the exchange as the provider spelled it, so this is where that string becomes
 *  the market's own vocabulary. A floor the tuple does not name resolves to unknown, never quietly
 *  to the primary exchange, whose band and tick table would then price a different venue. */
export function toVnExchange(raw: string | undefined): VnExchange | undefined {
  const named = raw?.toUpperCase()

  return VN_EXCHANGES.find((exchange) => exchange === named)
}

/** The grid a name trades on, read off its stored record: a name the universe does not hold prices
 *  on the primary exchange's table, as `resolveTradeability` does for an unknown exchange. */
export async function resolveVnTickSize(
  deps: Pick<MarketDeps, 'marketDataStore'>,
  request: TickSizeRequest
): Promise<TickSizePolicy> {
  const record = await deps.marketDataStore.findInstrument(request)

  return record === null
    ? SHARE_TICK_BY_EXCHANGE[PRIMARY_EXCHANGE]
    : tickPolicyFor(record.kind, toVnExchange(record.exchange) ?? PRIMARY_EXCHANGE)
}

/** ETFs and covered warrants use a flat tick at any price on every exchange; shares use the
 *  listing exchange's table. */
function tickPolicyFor(kind: InstrumentKind, exchange: VnExchange): TickSizePolicy {
  return kind === 'etf' ? FUND_TICK : SHARE_TICK_BY_EXCHANGE[exchange]
}

/** The widened first-day band applies to a name whose listing day is today. A resumption after a
 *  long suspension gets the same treatment through the same field when the source restates it. */
function isFirstSession(record: InstrumentRecord, asOf: TradingDay): boolean {
  return record.listedOn !== undefined && record.listedOn === asOf
}

/** Public companies default to a 100% cap; banks to 30%, except the compulsory-transfer banks
 *  Decree 69/2025 lifts to 49%. A source that carries the instrument's own cap wins over all
 *  three — the effective cap is per-instrument data, never a blanket constant. */
function foreignRoomOf(record: InstrumentRecord): number {
  if (record.foreignOwnershipLimitPct !== undefined) {
    return record.foreignOwnershipLimitPct
  }

  if (record.sector !== BANK_SECTOR) {
    return DEFAULT_FOREIGN_ROOM_FRACTION
  }

  return COMPULSORY_TRANSFER_BANK_TICKERS.includes(record.instrument.ticker)
    ? COMPULSORY_TRANSFER_BANK_ROOM_FRACTION
    : BANK_FOREIGN_ROOM_FRACTION
}

/** A move this close to the band is the band: tick rounding keeps an adjusted series off the exact
 *  ceiling ratio. */
export function isLimitMove(move: number, bandPct: number): boolean {
  return move >= bandPct * LIMIT_HIT_TOLERANCE_FRACTION
}

interface CeilingRunScope {
  readonly bandPct: number
  readonly calendar: TradingCalendar
  readonly listedOn?: TradingDay
}

/** How many of the newest sessions in a row closed at the ceiling: a limit-sized rise that also
 *  ended on the session's high. The run stops at the first session that did not. */
export function ceilingRunOf(candles: readonly Candle[], scope: CeilingRunScope): number {
  let run = 0

  for (let index = candles.length - 1; index > 0; index -= 1) {
    const current = candles[index]
    const previous = candles[index - 1]

    if (current === undefined || previous === undefined) {
      break
    }

    if (!isCeilingSession(current, previous, scope)) {
      break
    }

    run += 1
  }

  return run
}

/** Read only against the session right before it: across a missing bar or a suspension the move
 *  spans several sessions, and a listing day trades under the widened first-day band. */
function isCeilingSession(current: Candle, previous: Candle, scope: CeilingRunScope): boolean {
  return (
    previous.close > 0 &&
    current.at !== scope.listedOn &&
    scope.calendar.addTradingDays(previous.at, 1) === current.at &&
    current.close >= current.high &&
    isLimitMove(current.close / previous.close - 1, scope.bandPct)
  )
}

/** One price all session, at the limit: the board never opened on the other side. */
function limitLockOf(
  bar: Candle,
  previousClose: number,
  band: DailyPriceBandPolicy
): LimitLock | undefined {
  if (bar.high !== bar.low || previousClose <= 0) {
    return undefined
  }

  const move = bar.close / previousClose - 1

  if (isLimitMove(move, band.maximumUpPct)) {
    return 'ceiling'
  }

  return isLimitMove(-move, band.maximumDownPct) ? 'floor' : undefined
}

export const VN_PRICE_LIMIT: MarketPriceLimit = Object.freeze({ lockOf: limitLockOf })
