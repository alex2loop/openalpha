import type { Candle, FundingSnapshot } from '@/trading/kernel/market/market-data'
import type { TapeReading } from '@/trading/kernel/market/tape'
import {
  CRYPTO_RELATIVE_VOLUME_SESSIONS,
  LEVERAGE_LED_MINIMUM_RUN,
  LEVERAGE_LED_OI_MULTIPLE,
  WASHOUT_CLOSE_RANGE_FRACTION,
  WASHOUT_HOLD_SESSIONS,
  WASHOUT_MINIMUM_FALL,
  WASHOUT_RELATIVE_VOLUME,
  WASHOUT_RUN_SESSIONS,
} from '@/trading/markets/crypto/policy'
import { nSessionReturn, relativeVolume } from '@/trading/markets/timeseries'

/** The two series a tape signal reads. Structural rather than `CryptoAssetEvidence` so the screen
 *  and the factor run hand over exactly what they hold. */
interface TapeEvidence {
  /** Daily bars, oldest first, ending on the settled session. */
  readonly candles: readonly Candle[]
  readonly funding?: FundingSnapshot
}

export function cryptoTapeReadings(evidence: TapeEvidence): readonly TapeReading[] {
  return [...washoutHeld(evidence.candles), ...leverageLed(evidence)]
}

/** The newest washout whose low every later session has held. Read from the nearest eligible
 *  session outward, so a fresh hold outranks an older one. */
function washoutHeld(candles: readonly Candle[]): readonly TapeReading[] {
  const { minimum, maximum } = WASHOUT_HOLD_SESSIONS

  for (let held = minimum; held <= maximum; held += 1) {
    const reading = washoutAt(candles, candles.length - 1 - held)

    if (reading !== undefined) {
      return [reading]
    }
  }

  return []
}

interface WashoutMeasures {
  readonly fall: number
  readonly volume: number
}

/** The fall into the newest session and its relative volume, when that session reads as a washout:
 *  down on heavy volume after a fall, closing near its low. */
function washoutMeasures(through: readonly Candle[]): WashoutMeasures | undefined {
  const washout = through.at(-1)

  if (washout === undefined || washout.high <= washout.low) {
    return undefined
  }

  const fall = nSessionReturn(
    through.map((candle) => candle.close),
    WASHOUT_RUN_SESSIONS
  )
  const volume = relativeVolume(
    through.map((candle) => candle.volume),
    CRYPTO_RELATIVE_VOLUME_SESSIONS
  )
  const closeInRange = (washout.close - washout.low) / (washout.high - washout.low)

  if (fall === undefined || fall > -WASHOUT_MINIMUM_FALL) {
    return undefined
  }

  if (volume === undefined || volume < WASHOUT_RELATIVE_VOLUME) {
    return undefined
  }

  return closeInRange > WASHOUT_CLOSE_RANGE_FRACTION ? undefined : { fall, volume }
}

/** A washout has held when no later low undercuts it. */
function washoutAt(candles: readonly Candle[], index: number): TapeReading | undefined {
  if (index < 0) {
    return undefined
  }

  const washout = candles[index]
  const measures = washoutMeasures(candles.slice(0, index + 1))

  if (washout === undefined || measures === undefined) {
    return undefined
  }

  const held = candles.slice(index + 1).every((candle) => candle.low > washout.low)

  return held
    ? { signal: 'washout-held', day: washout.at, measure: measures.volume, run: measures.fall }
    : undefined
}

/** Price and contract count over the same sessions: a rise the count outran twice over is being
 *  carried by new positions, which are the ones that unwind first. */
function leverageLed(evidence: TapeEvidence): readonly TapeReading[] {
  const change = evidence.funding?.openInterestChange
  const last = evidence.candles.at(-1)

  if (change === undefined || last === undefined) {
    return []
  }

  const run = nSessionReturn(
    evidence.candles.map((candle) => candle.close),
    change.sessions
  )

  if (run === undefined || run < LEVERAGE_LED_MINIMUM_RUN) {
    return []
  }

  return change.value >= run * LEVERAGE_LED_OI_MULTIPLE
    ? [{ signal: 'leverage-led', day: last.at, measure: change.value, run }]
    : []
}
