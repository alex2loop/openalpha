import type { InstrumentStatus } from '@/trading/kernel/caveat'
import type { InstrumentKind, InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type {
  BarRecord,
  Candle,
  FundamentalSnapshot,
  InstrumentRecord,
} from '@/trading/kernel/market/market-data'
import type { SupervisionLevel } from '@/trading/kernel/market/supervision'
import type { ScreenGateCode } from '@/trading/kernel/screen-codes'
import type { VnExchange } from '@/trading/markets/equity-vn/policy'
import { SUPERVISION_LEVELS } from '@/trading/kernel/market/supervision'
import {
  DAILY_BAND_BY_EXCHANGE,
  LIMIT_HIT_LOOKBACK_SESSIONS,
  LIMIT_HIT_MAXIMUM,
  LIQUIDITY_SESSIONS,
  MAXIMUM_DAILY_VOLATILITY,
  MINIMUM_ETF_MEDIAN_TURNOVER_VND,
  MINIMUM_FREE_FLOAT_PCT,
  MINIMUM_HISTORY_SESSIONS,
  MINIMUM_MARKET_CAP_VND,
  MINIMUM_MEDIAN_TURNOVER_VND,
  MINIMUM_TRADING_FREQUENCY_FRACTION,
  PRIMARY_EXCHANGE,
  TRADING_FREQUENCY_SESSIONS,
  VOLATILITY_SESSIONS,
} from '@/trading/markets/equity-vn/policy'
import {
  hasForeignRoom,
  isLimitMove,
  resolveBandReference,
  resolveTradeability,
  toVnExchange,
} from '@/trading/markets/equity-vn/tradeability'
import { realizedVolatility } from '@/trading/markets/timeseries'
import { medianTurnover } from '@/trading/markets/turnover'

/** The two bands, each read positively by its own gate, so a supervised name fails exactly one and
 *  the reported reason names what is actually wrong with it. The second is derived rather than
 *  listed: a level added to the vocabulary and forgotten here would otherwise clear both gates, and
 *  falling into the band that lowers conviction is the safe side of that mistake. */
const RESTRICTED_SUPERVISION: ReadonlySet<SupervisionLevel> = new Set(['restricted', 'suspended'])
const DISCLOSURE_SUPERVISION: ReadonlySet<SupervisionLevel> = new Set(
  SUPERVISION_LEVELS.filter((level) => !RESTRICTED_SUPERVISION.has(level))
)

export interface ScreenInput {
  readonly instrument: InstrumentRef
  readonly status: InstrumentStatus
  readonly kind: InstrumentKind
  /** The listing exchange, resolved the same way `resolveTradeability` does: a name's own daily
   *  band, never the primary exchange's, gates its limit-hit history. */
  readonly exchange: VnExchange
  /** Adjusted daily bars, oldest first. Unadjusted series never reach a screen: a split would
   *  read as a crash and misrank a healthy name. */
  readonly bars: readonly BarRecord[]
  readonly lastClose?: number
  /** At or above this the name is locked at its ceiling today. `resolveTradeability` owns the
   *  derivation, and the board republishes it so the live re-check tests the very same number. */
  readonly lockPrice?: number
  /** The same lock for the session `lastClose` printed in: a close is judged against the ceiling
   *  of its own day, never against tomorrow's, which every close sits under. */
  readonly settledLockPrice?: number
  readonly marketCap?: number
  /** What the exchange has declared about this name, when a reading was available. */
  readonly supervision?: SupervisionLevel
  readonly freeFloatPct?: number
  /** No foreign room left on the board's day. Only a foreign operator is bound by it. */
  readonly foreignRoomExhausted?: true
  /** When this listing began, so the history window can be tested against one board's tape. */
  readonly listedOn?: TradingDay
}

/** The evidence fields a screen input is built from — the subset of a day's per-name evidence the
 *  gates read. */
interface ScreenInputSource {
  readonly record: InstrumentRecord
  readonly bars: readonly BarRecord[]
  readonly closes: readonly number[]
  readonly fundamental: FundamentalSnapshot | null
  readonly supervision?: SupervisionLevel
}

interface ScreenGate {
  readonly code: ScreenGateCode
  readonly test: (candidate: ScreenInput) => boolean
}

// Every test is a pass predicate — true means the candidate clears this gate. Two prefix families,
// chosen by what is being asked: `has*` for "is there enough data", `is*` for "is the candidate in
// an acceptable state". Never a negated name — a pass predicate that reads as a rejection is how a
// gate's polarity gets flipped by a later edit that trusts the name over the logic.
const GATES: readonly ScreenGate[] = Object.freeze([
  { code: 'no-price-history', test: hasAnyHistory },
  { code: 'insufficient-history', test: hasEnoughHistory },
  { code: 'below-minimum-traded-sessions', test: hasMinimumTradingFrequency },
  { code: 'below-minimum-turnover', test: hasMinimumTurnover },
  { code: 'below-minimum-market-cap', test: hasMinimumMarketCap },
  { code: 'below-minimum-free-float', test: hasMinimumFreeFloat },
  { code: 'abnormal-trading-status', test: isNormalStatus },
  { code: 'under-trading-restriction', test: isTradingUnrestricted },
  { code: 'under-supervision', test: isOutsideSupervision },
  { code: 'ceiling-locked', test: isCeilingUnlocked },
  { code: 'recent-limit-hits', test: isWithoutRecentLimitHits },
  { code: 'volatility-above-maximum', test: isWithinVolatilityLimit },
])

/** What the gates decide by that no policy constant names: which gates, in which order, and which
 *  supervision levels each one refuses. */
export const SCREEN_GATE_BASIS = Object.freeze({
  gates: GATES.map((gate) => gate.code),
  restricted: [...RESTRICTED_SUPERVISION],
  disclosure: [...DISCLOSURE_SUPERVISION],
})

/** The one `NameEvidence` to `ScreenInput` mapping, shared by the screen and the suggestion gate so
 *  the two cannot judge a name on differently-built inputs. */
export function toScreenInput(source: ScreenInputSource, asOf: TradingDay): ScreenInput {
  const { record, bars, closes } = source
  const marketCap = source.fundamental?.marketCap
  const freeFloatPct = source.fundamental?.freeFloatPct
  const candles = bars.map((bar) => bar.candle)
  const newest = candles[candles.length - 1]
  const lastClose = closes[closes.length - 1]
  const reference = resolveBandReference(candles, asOf) ?? lastClose
  const known = {
    instrument: record.instrument,
    status: record.status,
    kind: record.kind,
    exchange: exchangeOf(record),
    bars,
    ...(marketCap === undefined ? {} : { marketCap }),
    ...(source.supervision === undefined ? {} : { supervision: source.supervision }),
    ...(freeFloatPct === undefined ? {} : { freeFloatPct }),
    ...(record.listedOn === undefined ? {} : { listedOn: record.listedOn }),
  }

  if (lastClose === undefined || reference === undefined || newest === undefined) {
    return known
  }

  const tradeability = resolveTradeability({ record, reference, asOf })
  const settledReference = resolveBandReference(candles, newest.at)

  return {
    ...known,
    lastClose,
    lockPrice: tradeability.lockPrice,
    ...(hasForeignRoom(tradeability, record.foreignOwnershipPct, marketCap)
      ? {}
      : { foreignRoomExhausted: true as const }),
    ...(settledReference === undefined
      ? {}
      : {
          settledLockPrice: resolveTradeability({
            record,
            reference: settledReference,
            asOf: newest.at,
          }).lockPrice,
        }),
  }
}

/** Every gate this candidate fails, in table order. A screen reports only the first, because it owes
 *  one stable reason; the suggestion path needs them all, because it blocks on some of them and
 *  only spends conviction on others. */
export function failedGates(candidate: ScreenInput): readonly ScreenGateCode[] {
  return GATES.filter((gate) => !gate.test(candidate)).map((gate) => gate.code)
}

/** The listing exchange, resolved the same way `resolveTradeability` does. */
export function exchangeOf(record: InstrumentRecord): VnExchange {
  return toVnExchange(record.exchange) ?? PRIMARY_EXCHANGE
}

export function adjustedCloses(bars: readonly BarRecord[]): readonly number[] {
  return adjustedBars(bars).map((bar) => bar.candle.close)
}

/** The same adjusted rows as `adjustedCloses`, kept as candles so a cross-series pairing (tracking
 *  error against an index) can align by trading day rather than array position. */
export function adjustedCandles(bars: readonly BarRecord[]): readonly Candle[] {
  return adjustedBars(bars).map((bar) => bar.candle)
}

function adjustedBars(bars: readonly BarRecord[]): readonly BarRecord[] {
  return bars.filter(isAdjustedBar)
}

/** Whether a bar is one of the series the factors read: adjusted, with a usable close. */
export function isAdjustedBar(bar: BarRecord): boolean {
  return bar.candle.adjustment === 'adjusted' && bar.candle.close > 0
}

/** No series at all is a gap in our coverage, not a young listing: "too little history" said of a
 *  name that has years of it sends the reader to the wrong conclusion. */
function hasAnyHistory(candidate: ScreenInput): boolean {
  return candidate.bars.length > 0
}

/** Long enough, and from one listing: a name that changed boards carries its old exchange's band
 *  and tick table before the move, so a statistic across that seam averages two regimes. An unknown
 *  listing date passes, as an unknown market cap does. */
function hasEnoughHistory(candidate: ScreenInput): boolean {
  const window = adjustedBars(candidate.bars).slice(-MINIMUM_HISTORY_SESSIONS)
  const oldest = window[0]

  if (window.length < MINIMUM_HISTORY_SESSIONS || oldest === undefined) {
    return false
  }

  return candidate.listedOn === undefined || oldest.candle.at >= candidate.listedOn
}

/** Divided by the window, not by the bars present, so a series with sessions missing fails closed
 *  instead of counting the days it happens to have. */
function hasMinimumTradingFrequency(candidate: ScreenInput): boolean {
  const traded = candidate.bars
    .slice(-TRADING_FREQUENCY_SESSIONS)
    .filter((bar) => bar.candle.volume > 0)

  return traded.length / TRADING_FREQUENCY_SESSIONS >= MINIMUM_TRADING_FREQUENCY_FRACTION
}

/** A fund clears a lower bar than a share: its price is held to its basket by arbitrage, so the
 *  floor only has to answer whether a ticket can leave. An unmeasured window fails, unlike the
 *  unknown capitalisation above: that is one snapshot missing beside a tape this still reads. */
function hasMinimumTurnover(candidate: ScreenInput): boolean {
  const floor =
    candidate.kind === 'etf' ? MINIMUM_ETF_MEDIAN_TURNOVER_VND : MINIMUM_MEDIAN_TURNOVER_VND
  const turnover = medianTurnover(candidate.bars, LIQUIDITY_SESSIONS)

  return turnover !== undefined && turnover >= floor
}

/** An unknown capitalisation passes: the fundamentals refresh is a separate provider call, and a
 *  name whose snapshot has not landed yet is unmeasured rather than small. */
function hasMinimumMarketCap(candidate: ScreenInput): boolean {
  return candidate.marketCap === undefined || candidate.marketCap >= MINIMUM_MARKET_CAP_VND
}

/** An unknown float passes for the same reason an unknown capitalisation does. */
function hasMinimumFreeFloat(candidate: ScreenInput): boolean {
  return candidate.freeFloatPct === undefined || candidate.freeFloatPct >= MINIMUM_FREE_FLOAT_PCT
}

function isNormalStatus(candidate: ScreenInput): boolean {
  return candidate.status === 'active'
}

/** Restricted or suspended: matching is periodic or stopped, so the levels below would quote a
 *  price no order can take. An unread supervision status passes, as an unknown ceiling does. */
function isTradingUnrestricted(candidate: ScreenInput): boolean {
  return candidate.supervision === undefined || !RESTRICTED_SUPERVISION.has(candidate.supervision)
}

/** Warned or controlled: the tape still works, and the exchange has said the issuer's disclosure
 *  does not. A buy board declines to rank that; a named ticker is still analysable. */
function isOutsideSupervision(candidate: ScreenInput): boolean {
  return candidate.supervision === undefined || !DISCLOSURE_SUPERVISION.has(candidate.supervision)
}

/** A name that closed on its ceiling cannot be bought at a sane price the next morning. An unknown
 *  ceiling passes: the tradeability path reports that as a caveat, and two owners disagreeing about
 *  one condition is how a name gets rejected with a misleading code. */
function isCeilingUnlocked(candidate: ScreenInput): boolean {
  const { lastClose, settledLockPrice } = candidate

  if (lastClose === undefined || settledLockPrice === undefined || settledLockPrice <= 0) {
    return true
  }

  return lastClose < settledLockPrice
}

/** Ratios of adjacent adjusted closes, so an ex-date restatement never reads as a limit move,
 *  against the candidate's own listing exchange — HNX and UPCOM trade a wider band than HOSE. */
function recentLimitHitCount(closes: readonly number[], exchange: VnExchange): number {
  const window = closes.slice(-(LIMIT_HIT_LOOKBACK_SESSIONS + 1))
  const bandPct = DAILY_BAND_BY_EXCHANGE[exchange].maximumUpPct
  let hits = 0

  for (let index = 1; index < window.length; index += 1) {
    const previous = window[index - 1]
    const current = window[index]

    if (previous !== undefined && current !== undefined && previous > 0) {
      hits += isLimitMove(current / previous - 1, bandPct) ? 1 : 0
    }
  }

  return hits
}

function isWithoutRecentLimitHits(candidate: ScreenInput): boolean {
  return recentLimitHitCount(adjustedCloses(candidate.bars), candidate.exchange) < LIMIT_HIT_MAXIMUM
}

function isWithinVolatilityLimit(candidate: ScreenInput): boolean {
  const volatility = realizedVolatility(adjustedCloses(candidate.bars), VOLATILITY_SESSIONS)

  return volatility === undefined || volatility <= MAXIMUM_DAILY_VOLATILITY
}
