import type { FactorComposite, FactorResult } from '@/trading/kernel/factor'
import type { InstrumentRef, Ticker } from '@/trading/kernel/instrument'
import type { ScreenCandidate } from '@/trading/kernel/market/market-capability'
import type { Candle, MarketCapRecord, Quote } from '@/trading/kernel/market/market-data'
import type { TapeReading } from '@/trading/kernel/market/tape'
import type { ScreenGateCode } from '@/trading/kernel/screen-codes'
import type { ScreenGateVerdict } from '@/trading/markets/screen-partition'
import { factorComposite } from '@/trading/kernel/factor'
import {
  CHOPPINESS_SESSIONS,
  CRYPTO_MAXIMUM_DAILY_VOLATILITY,
  CRYPTO_MINIMUM_DAILY_VOLATILITY,
  CRYPTO_MINIMUM_HISTORY_SESSIONS,
  CRYPTO_VOLATILITY_SESSIONS,
  MAXIMUM_CHOPPINESS,
} from '@/trading/markets/crypto/policy'
import { UNSCORED_COMPOSITE } from '@/trading/markets/factor-scoring'
import { averageTrueRange, hasIntradayRange } from '@/trading/markets/levels'
import { realizedVolatility } from '@/trading/markets/timeseries'

const PERCENT_SCALE = 100

/** What the candle gates read, and nothing else: the suggestion path holds a series and no board
 *  row, and inventing a quote to satisfy a screen shape is how the two drift apart. Unexported on
 *  purpose — a caller builds the literal, and `CryptoScreenInput` is the named shape it extends. */
interface GateEvidence {
  /** Daily bars, oldest first. */
  readonly candles: readonly Candle[]
}

export interface CryptoScreenInput extends GateEvidence {
  readonly instrument: InstrumentRef
  readonly name?: string
  readonly marketCapUsd: number
  /** Aggregate across venues, like the market cap it is weighed against. */
  readonly totalVolumeUsd: number
  /** The price the universe sweep already answered with, so the board is not re-quoted per name
   *  against a rate limit the sweep itself shares. */
  readonly liveQuote: Quote
}

/** The sweep answered with a price for every row it returned, so the board reads it from there
 *  rather than re-quoting each name against the rate limit that sweep shares. */
export function sweepQuote(row: MarketCapRecord): Quote {
  return {
    instrument: row.instrument,
    price: row.priceUsd,
    ...(row.changePct === undefined ? {} : { changePct: row.changePct }),
    observedAt: row.observedAt,
  }
}

export interface CryptoRankedFactors extends FactorComposite {
  readonly factors: readonly FactorResult[]
  readonly signals: readonly TapeReading[]
}

interface ScreenGate {
  readonly code: ScreenGateCode
  readonly test: (candidate: GateEvidence) => boolean
}

// Every test is a pass predicate — true means the candidate clears this gate. Ordered
// cheapest-and-most-fundamental first, so the recorded rejection is the most informative one.
const GATES: readonly ScreenGate[] = Object.freeze([
  { code: 'no-price-history', test: hasAnyHistory },
  { code: 'insufficient-history', test: hasEnoughHistory },
  { code: 'volatility-above-maximum', test: isWithinVolatilityLimit },
  { code: 'volatility-below-minimum', test: isAboveVolatilityFloor },
  { code: 'choppy-range', test: isOutsideChoppyRange },
])

/** A name failing three gates records the first. Recording all three would make the reason unstable
 *  across days as unrelated conditions changed. */
export function screenCryptoCandidate(candidate: GateEvidence): ScreenGateVerdict {
  for (const gate of GATES) {
    if (!gate.test(candidate)) {
      return { kind: 'rejected', code: gate.code }
    }
  }

  return { kind: 'accepted' }
}

/** Every gate this candidate fails, in table order. `screenCryptoCandidate` records only the first,
 *  because a screen owes one stable reason; the suggestion path needs them all, because it blocks on
 *  some of them and only spends conviction on others. Kept separate rather than folded into
 *  `screenCryptoCandidate`, whose short-circuit is what keeps a universe-wide pass cheap. */
export function cryptoFailedGates(candidate: GateEvidence): readonly ScreenGateCode[] {
  return GATES.filter((gate) => !gate.test(candidate)).map((gate) => gate.code)
}

/** `screenCryptoCandidate` decides who clears the gates; this decides order. There is no second weight
 *  table: the market supplies the identical scored result the suggestion pipeline uses, so "ranked
 *  first" and "strong enough to suggest" cannot disagree about what strong means. */
export function rankCryptoSurvivors(
  survivors: readonly CryptoScreenInput[],
  factorsByTicker: ReadonlyMap<Ticker, CryptoRankedFactors>
): readonly ScreenCandidate[] {
  const scored = survivors.map((candidate) => {
    const scoredFactors = factorsByTicker.get(candidate.instrument.ticker)
    const newest = candidate.candles.at(-1)
    const volatilityDaily = dailyVolatilityOf(candidate)

    return {
      instrument: candidate.instrument,
      ...(candidate.name === undefined ? {} : { name: candidate.name }),
      composite: scoredFactors === undefined ? UNSCORED_COMPOSITE : factorComposite(scoredFactors),
      factors: scoredFactors?.factors ?? [],
      ...(scoredFactors === undefined || scoredFactors.signals.length === 0
        ? {}
        : { signals: scoredFactors.signals.map((reading) => reading.signal) }),
      liveQuote: candidate.liveQuote,
      ...(newest === undefined ? {} : { previousClose: { price: newest.close, at: newest.at } }),
      ...(volatilityDaily === undefined ? {} : { volatilityDaily }),
    }
  })

  // Score descending, then ticker: the composite is the complete ranking policy, and the second key
  // makes equal scores stable without introducing a second, implicit weight.
  return scored.sort(
    (left, right) =>
      right.composite.score - left.composite.score ||
      left.instrument.ticker.localeCompare(right.instrument.ticker)
  )
}

/** No series at all is a gap in our coverage, not a young coin: "too little history" said of a
 *  name that has years of it sends the reader to the wrong conclusion. */
function hasAnyHistory(candidate: GateEvidence): boolean {
  return candidate.candles.length > 0
}

function hasEnoughHistory(candidate: GateEvidence): boolean {
  return candidate.candles.length >= CRYPTO_MINIMUM_HISTORY_SESSIONS
}

/** A hard policy floor, deliberately separate from the `volatility` factor: the factor scores
 *  relative calm among survivors, and a single mechanism would let a strong trend score buy back
 *  an asset the policy already excluded. */
function isWithinVolatilityLimit(candidate: GateEvidence): boolean {
  const volatility = dailyVolatilityOf(candidate)

  return volatility === undefined || volatility <= CRYPTO_MAXIMUM_DAILY_VOLATILITY
}

/** The other end of the same reading, and a different question: the ceiling asks whether an asset
 *  moves too violently to size, this asks whether it moves at all. An absent volatility abstains
 *  here as it does above — a series too short to measure is the history gate's rejection, not this
 *  one's. */
function isAboveVolatilityFloor(candidate: GateEvidence): boolean {
  const volatility = dailyVolatilityOf(candidate)

  return volatility === undefined || volatility >= CRYPTO_MINIMUM_DAILY_VOLATILITY
}

/** One window for both policy gates and for the reading the board publishes, so a name cannot be
 *  admitted on one measure of its own volatility and judged against another. */
function dailyVolatilityOf(candidate: GateEvidence): number | undefined {
  return realizedVolatility(
    candidate.candles.map((candle) => candle.close),
    CRYPTO_VOLATILITY_SESSIONS
  )
}

function isOutsideChoppyRange(candidate: GateEvidence): boolean {
  const choppiness = choppinessIndex(candidate.candles)

  return choppiness === undefined || choppiness <= MAXIMUM_CHOPPINESS
}

/** The classic choppiness index: summed true range over the window's own high-low span, on a
 *  0-100 log scale. High means the asset covered a lot of ground without going anywhere, which is
 *  exactly where a trend factor measures noise. Absent when the window has no span to divide by. */
function choppinessIndex(candles: readonly Candle[]): number | undefined {
  // One extra candle: every true range in the sum needs the prior close, and a shorter series
  // averages fewer ranges than the multiplier below assumes.
  if (candles.length < CHOPPINESS_SESSIONS + 1) {
    return undefined
  }

  // Both terms of the ratio are built from session ranges. Without them the numerator shrinks to the
  // close-to-close path and the denominator to the close envelope, and the index reads tens of
  // points calmer than the same asset measured properly — an easier gate for no reason but which
  // provider answered.
  if (!hasIntradayRange(candles, CHOPPINESS_SESSIONS)) {
    return undefined
  }

  const window = candles.slice(-CHOPPINESS_SESSIONS)
  const span =
    Math.max(...window.map((candle) => candle.high)) -
    Math.min(...window.map((candle) => candle.low))
  const summedTrueRange = averageTrueRange(candles, CHOPPINESS_SESSIONS) * CHOPPINESS_SESSIONS

  if (span <= 0 || summedTrueRange <= 0) {
    return undefined
  }

  return (PERCENT_SCALE * Math.log10(summedTrueRange / span)) / Math.log10(CHOPPINESS_SESSIONS)
}
